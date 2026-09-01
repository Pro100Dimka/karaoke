import sys
import threading
import time
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
import soundfile as sf

import AI.pipeline as pipeline_module
from AI.artifacts import publish_files_atomically
from AI.engines.separation import MSSTMelRoformerSeparator
from AI.engines.text import (
    Qwen3ForcedAligner,
    _acoustic_runs,
    _enforce_monotonic_starts,
    _fill_unresolved_timed_lines,
    _invalid_runs,
    _repair_collapsed_timed_lines,
    _timed_line_plan,
    _timed_line_retry_stages,
    resolve_alignment_language,
    tokenize,
)
from AI.errors import InvalidArtifactError, ProcessingCancelledError
from AI.lyrics_sources import LyricsDiscovery, TimedLine, _expand_notation, discover_lyrics
from AI.models import PitchFrame, Word
from AI.pipeline import KaraokePipeline, PipelineRequest


class Separator:
    name = "test-separator"

    @staticmethod
    def separate(mix, vocals, instrumental, *, profile=None, cancelled=None):
        audio, rate = sf.read(mix, dtype="float32", always_2d=True)
        sf.write(vocals, audio, rate)
        sf.write(instrumental, audio * 0, rate)

    @staticmethod
    def close():
        return None


def test_model_parking_unloads_on_memory_constrained_computers(monkeypatch):
    engine = SimpleNamespace(close=Mock(), park=Mock())
    memory = SimpleNamespace(total=16 * 1024**3, available=5 * 1024**3)
    monkeypatch.setitem(sys.modules, "psutil", SimpleNamespace(virtual_memory=lambda: memory))
    monkeypatch.setattr(pipeline_module, "release_torch_memory", lambda: None)

    KaraokePipeline._park_engines(engine)

    engine.close.assert_called_once_with()
    engine.park.assert_not_called()


def test_model_parking_keeps_warm_models_only_with_ram_headroom(monkeypatch):
    engine = SimpleNamespace(
        close=Mock(),
        park=Mock(),
    )
    memory = SimpleNamespace(total=64 * 1024**3, available=20 * 1024**3)
    monkeypatch.setitem(sys.modules, "psutil", SimpleNamespace(virtual_memory=lambda: memory))
    monkeypatch.setattr(pipeline_module, "release_torch_memory", lambda: None)

    KaraokePipeline._park_engines(engine)

    engine.park.assert_called_once_with()
    engine.close.assert_not_called()


class Pitch:
    name = "test-pitch"

    @staticmethod
    def estimate(_audio):
        return [PitchFrame(time / 100, 440, 1, True) for time in range(100, 151)]


class Aligner:
    name = "test-aligner"

    @staticmethod
    def align_long_text(_audio, text, _language):
        return [Word(1, 1.6, text, index=0)]


def test_clean_pipeline_publishes_only_canonical_runtime_artifacts(tmp_path, monkeypatch):
    source, lyrics, output = tmp_path / "source.wav", tmp_path / "lyrics.txt", tmp_path / "out"
    sf.write(source, np.zeros((44100 * 2, 2), dtype=np.float32), 44100)
    lyrics.write_text("hello", encoding="utf-8")
    monkeypatch.setattr("AI.pipeline.analyze_music", lambda _path: {"bpm": 120, "key": "A minor"})
    engines = SimpleNamespace(
        separator=Separator(), pitch=Pitch(), transcriber=None, aligner=Aligner()
    )

    result = KaraokePipeline(engines=engines).run(PipelineRequest(source, output, lyrics_path=lyrics))

    assert result.manifest_path == output / "lyricsSync.json"
    assert {path.name for path in output.iterdir()} == {
        "instrumental.flac",
        "lyricsSync.json",
        "vocals.flac",
    }
    assert sf.info(output / "vocals.flac").channels == 1


def test_pipeline_releases_separator_before_loading_later_gpu_models(tmp_path, monkeypatch):
    source, lyrics, output = tmp_path / "source.wav", tmp_path / "lyrics.txt", tmp_path / "out"
    sf.write(source, np.zeros((44100 * 2, 2), dtype=np.float32), 44100)
    lyrics.write_text("hello", encoding="utf-8")
    monkeypatch.setattr("AI.pipeline.analyze_music", lambda _path: {"bpm": 120, "key": "A minor"})
    events = []

    class ReleasableSeparator(Separator):
        @staticmethod
        def separate(*args, **kwargs):
            Separator.separate(*args, **kwargs)
            events.append("separated")

        @staticmethod
        def close():
            events.append("released")

    class CheckedPitch(Pitch):
        @staticmethod
        def estimate(audio):
            assert events == ["separated", "released"]
            return Pitch.estimate(audio)

    engines = SimpleNamespace(
        separator=ReleasableSeparator(), pitch=CheckedPitch(),
        transcriber=None, aligner=Aligner(),
    )

    KaraokePipeline(engines=engines).run(PipelineRequest(source, output, lyrics_path=lyrics))

    assert events == ["separated", "released"]


def test_pipeline_keeps_full_ctc_word_boundaries_without_global_vad_reanchoring(
    tmp_path, monkeypatch
):
    source, lyrics, output = tmp_path / "source.wav", tmp_path / "lyrics.txt", tmp_path / "out"
    sf.write(source, np.zeros((44100 * 2, 2), dtype=np.float32), 44100)
    lyrics.write_text("first second", encoding="utf-8")
    monkeypatch.setattr("AI.pipeline.analyze_music", lambda _path: {"bpm": 120, "key": "A minor"})
    monkeypatch.setattr(
        "AI.pipeline.anchor_words_to_voice",
        lambda *_args: (_ for _ in ()).throw(AssertionError("CTC boundaries must stay intact")),
    )
    aligner = SimpleNamespace(
        name="ctc-full",
        needs_voice_anchoring=False,
        align_long_text=lambda *_args: [
            Word(0.2, 0.6, "first", index=0),
            Word(1.1, 1.6, "second", index=1),
        ],
    )
    engines = SimpleNamespace(
        separator=Separator(), pitch=Pitch(), transcriber=None, aligner=aligner
    )

    KaraokePipeline(engines=engines).run(
        PipelineRequest(source, output, lyrics_path=lyrics)
    )

    payload = __import__("json").loads((output / "lyricsSync.json").read_text(encoding="utf-8"))
    assert [(word["start"], word["end"]) for word in payload["words"]] == [
        (0.2, 0.6),
        (1.1, 1.6),
    ]


def test_stage_reports_carry_device_dtype_and_memory_telemetry(tmp_path, monkeypatch):
    from AI.runtime import BackendSpec, HardwareProfile, RuntimePlan

    source, lyrics, output = tmp_path / "source.wav", tmp_path / "lyrics.txt", tmp_path / "out"
    sf.write(source, np.zeros((44100 * 2, 2), dtype=np.float32), 44100)
    lyrics.write_text("hello", encoding="utf-8")
    monkeypatch.setattr("AI.pipeline.analyze_music", lambda _path: {"bpm": 120, "key": "A minor"})
    plan = RuntimePlan(
        HardwareProfile("cpu", 4),
        {
            "separation": BackendSpec("pytorch:cuda", "cuda", "fp16"),
            "pitch": BackendSpec("pytorch:cpu", "cpu", "fp32"),
            "aligner": BackendSpec("pytorch:cpu", "cpu", "fp32"),
        },
    )
    monkeypatch.setattr("AI.pipeline.get_runtime_plan", lambda: plan)
    engines = SimpleNamespace(
        separator=Separator(), pitch=Pitch(), transcriber=None, aligner=Aligner()
    )

    result = KaraokePipeline(engines=engines).run(PipelineRequest(source, output, lyrics_path=lyrics))

    by_stage = {report.stage: report for report in result.reports}
    assert (by_stage["separate"].details["device"], by_stage["separate"].details["dtype"]) == ("cuda", "fp16")
    assert (by_stage["pitch"].details["device"], by_stage["pitch"].details["dtype"]) == ("cpu", "fp32")
    assert (by_stage["lyrics"].details["device"], by_stage["lyrics"].details["dtype"]) == ("cpu", "fp32")
    # decode has no backend role, but every stage still reports process memory use.
    assert all(report.details.get("rss_bytes", 0) > 0 for report in result.reports)
    assert "device" not in by_stage["decode"].details


def test_reprocess_rebuilds_timing_from_existing_vocals_without_separation(tmp_path):
    output = tmp_path / "out"
    output.mkdir()
    sf.write(output / "vocals.flac", np.zeros(44100 * 2, dtype=np.float32), 44100)
    (output / "instrumental.flac").write_bytes(b"minus stays untouched")
    (output / "lyricsSync.json").write_text(
        '{"bpm":120,"key":"A minor","text":"hello","words":['
        '{"start":0.1,"end":0.2,"text":"hello","notes":[]}]}',
        encoding="utf-8",
    )
    engines = SimpleNamespace(
        separator=Separator(), pitch=Pitch(), transcriber=None, aligner=Aligner()
    )

    result = KaraokePipeline(engines=engines).reprocess(output, language="en")

    assert result.manifest_path == output / "lyricsSync.json"
    assert (output / "instrumental.flac").read_bytes() == b"minus stays untouched"
    assert '"start": 1.0' in (output / "lyricsSync.json").read_text(encoding="utf-8")


def test_reprocess_reuses_matching_online_timed_lines(tmp_path, monkeypatch):
    output = tmp_path / "out"
    output.mkdir()
    sf.write(output / "vocals.flac", np.zeros(44100 * 4, dtype=np.float32), 44100)
    (output / "lyricsSync.json").write_text(
        '{"bpm":120,"key":"A minor","text":"right line\\nnext line","words":['
        '{"start":0.1,"end":0.2,"text":"right","notes":[]},'
        '{"start":0.2,"end":0.3,"text":"line","notes":[]},'
        '{"start":0.3,"end":0.4,"text":"next","notes":[]},'
        '{"start":0.4,"end":0.5,"text":"line","notes":[]}]}',
        encoding="utf-8",
    )
    timed_lines = (TimedLine(1.0, "right line"), TimedLine(3.0, "next line"))
    monkeypatch.setattr(
        "AI.pipeline.discover_lyrics",
        lambda _title: LyricsDiscovery(
            "right line\nnext line", "LRCLIB", "Artist Song", lines=timed_lines
        ),
    )

    class TimedAligner(Aligner):
        @staticmethod
        def align_timed_lines(_audio, _text, lines, _language):
            assert lines == timed_lines
            return [
                Word(1.0, 1.4, "right", index=0),
                Word(1.4, 1.8, "line", index=1),
                Word(3.0, 3.4, "next", index=2),
                Word(3.4, 3.8, "line", index=3),
            ]

        @staticmethod
        def align_long_text(*_args):
            raise AssertionError("full-song alignment must not run")

    engines = SimpleNamespace(
        separator=Separator(), pitch=Pitch(), transcriber=None, aligner=TimedAligner()
    )

    KaraokePipeline(engines=engines).reprocess(output, title="Artist - Song")

    payload = __import__("json").loads((output / "lyricsSync.json").read_text(encoding="utf-8"))
    assert [word["start"] for word in payload["words"]] == [1.0, 1.4, 3.0, 3.4]


def test_atomic_publish_restores_every_previous_artifact(tmp_path, monkeypatch):
    sources = [tmp_path / f"new-{index}" for index in range(2)]
    targets = [tmp_path / f"target-{index}" for index in range(2)]
    for index, path in enumerate(sources):
        path.write_text(f"new-{index}", encoding="utf-8")
    for index, path in enumerate(targets):
        path.write_text(f"old-{index}", encoding="utf-8")
    real_replace = __import__("os").replace

    def fail_second_publish(source, target):
        if source == sources[1] and target == targets[1]:
            raise OSError("disk failure")
        real_replace(source, target)

    monkeypatch.setattr("AI.artifacts.os.replace", fail_second_publish)

    with pytest.raises(OSError, match="disk failure"):
        publish_files_atomically(list(zip(sources, targets, strict=True)))

    assert [path.read_text(encoding="utf-8") for path in targets] == ["old-0", "old-1"]


def test_lyrics_tokens_match_qwen_space_language_contract():
    assert tokenize("Ты станешь слаще —\nА я, кто-то…") == [
        "Ты", "станешь", "слаще", "А", "я", "кто-то"
    ]
    assert resolve_alignment_language("текст", "ru-RU") == "Russian"
    assert resolve_alignment_language("український текст") == "Ukrainian"
    assert resolve_alignment_language("український текст", "ru") == "Ukrainian"


def test_lyrics_discovery_falls_back_to_verified_ukrainian_catalog(monkeypatch):
    search = '<a href="/songs/42.html">Лови момент</a>'
    detail = '''
        <h1>Лови момент</h1>
        <a href="/persons/7.html">АнтитілА</a>
        <pre class="songwords">Куплет один тут є\nПриспів:\nРядок приспіву один\nРядок приспіву два\n\nПриспів.</pre>
    '''

    def response(url, encoding="utf-8"):
        del encoding
        if "lrclib.net" in url:
            return "[]"
        return detail if "/songs/42.html" in url else search

    monkeypatch.setattr("AI.lyrics_sources._request", response)

    result = discover_lyrics("Антитiла - Лови момент")

    assert result is not None
    assert result.source == "pisni.org.ua"
    assert result.text.count("Рядок приспіву один") == 2


def test_lrclib_synced_text_is_kept_with_its_line_timestamps(monkeypatch):
    monkeypatch.setattr(
        "AI.lyrics_sources._request",
        lambda _url, _encoding="utf-8": """[{"trackName":"Song","artistName":"Artist","plainLyrics":"wrong text","syncedLyrics":"[00:01.00]right line\\n[00:03.00]next line"}]""",
    )

    result = discover_lyrics("Artist - Song")

    assert result is not None
    assert result.text == "right line\nnext line"
    assert result.lines == (TimedLine(1.0, "right line"), TimedLine(3.0, "next line"))


def test_pipeline_uses_discovered_timed_lines_instead_of_full_song_alignment(
    tmp_path, monkeypatch
):
    source, output = tmp_path / "source.wav", tmp_path / "out"
    sf.write(source, np.zeros((44100 * 4, 2), dtype=np.float32), 44100)
    monkeypatch.setattr("AI.pipeline.analyze_music", lambda _path: {"bpm": 120, "key": "A minor"})
    timed_lines = (TimedLine(1.0, "right line"), TimedLine(3.0, "next line"))
    monkeypatch.setattr(
        "AI.pipeline.discover_lyrics",
        lambda _title: LyricsDiscovery(
            "right line\nnext line", "LRCLIB", "Artist Song", lines=timed_lines
        ),
    )

    class TimedAligner(Aligner):
        @staticmethod
        def align_timed_lines(_audio, text, lines, _language):
            assert text == "right line\nnext line"
            assert lines == timed_lines
            return [
                Word(1.0, 1.4, "right", index=0),
                Word(1.4, 1.8, "line", index=1),
                Word(3.0, 3.4, "next", index=2),
                Word(3.4, 3.8, "line", index=3),
            ]

        @staticmethod
        def align_long_text(*_args):
            raise AssertionError("full-song alignment must not run")

    engines = SimpleNamespace(
        separator=Separator(), pitch=Pitch(), transcriber=None, aligner=TimedAligner()
    )

    KaraokePipeline(engines=engines).run(
        PipelineRequest(source, output, title="Artist - Song")
    )

    payload = __import__("json").loads((output / "lyricsSync.json").read_text(encoding="utf-8"))
    assert [(word["start"], word["end"]) for word in payload["words"]] == [
        (1.0, 1.4),
        (1.4, 1.8),
        (3.0, 3.4),
        (3.4, 3.8),
    ]


def test_lyrics_discovery_skips_pisni_once_the_lookup_budget_is_spent(monkeypatch):
    import AI.lyrics_sources as lyrics_sources

    monkeypatch.setattr(lyrics_sources, "_request", lambda url, encoding="utf-8": "[]")
    # The whole lookup already ran out its budget by the time LRCLIB replied
    # (a slow/hanging network, not a fast failure) -- pisni.org.ua must not
    # be attempted at all rather than adding its own request chain on top.
    clock = iter([0.0, 0.0, lyrics_sources.LOOKUP_BUDGET_SECONDS + 1])
    monkeypatch.setattr(lyrics_sources.time, "monotonic", lambda: next(clock))
    pisni_called = []
    monkeypatch.setattr(
        lyrics_sources, "_pisni", lambda *args: pisni_called.append(args) or None
    )

    assert discover_lyrics("Антитiла - Лови момент") is None
    assert pisni_called == []


def test_pisni_stops_walking_candidate_links_once_the_deadline_passes(monkeypatch):
    import AI.lyrics_sources as lyrics_sources

    search = '<a href="/songs/1.html">A</a><a href="/songs/2.html">B</a>'
    requested = []

    def response(url, encoding="utf-8"):
        del encoding
        requested.append(url)
        return search if "search.php" in url else "<h1></h1>"

    monkeypatch.setattr(lyrics_sources, "_request", response)
    # An already-expired budget must not start even the search request.
    result = lyrics_sources._pisni("Антитіла", "Лови момент", "query", deadline=0.0)

    assert result is None
    assert requested == []


def test_lyrics_request_returns_at_the_global_deadline_when_transport_stalls(monkeypatch):
    import AI.lyrics_sources as lyrics_sources

    release = threading.Event()
    monkeypatch.setattr(
        lyrics_sources,
        "_request",
        lambda *_args: release.wait(1) or "[]",
    )
    started = time.monotonic()
    try:
        with pytest.raises(TimeoutError, match="deadline"):
            lyrics_sources._request_before("https://lyrics.test", "utf-8", started + 0.03)
        assert time.monotonic() - started < 0.2
    finally:
        release.set()


def test_source_repeat_notation_is_expanded_without_leaking_markers():
    assert _expand_notation("Лови момент | (3)") == "\n".join(["Лови момент"] * 3)


def test_forced_aligner_does_not_expect_timestamps_for_punctuation(monkeypatch):
    text = "Ты станешь слаще —\nА я"
    items = [
        {"text": token.replace("-", ""), "start_time": index, "end_time": index + 0.5}
        for index, token in enumerate(tokenize(text))
    ]
    model = SimpleNamespace(align=lambda **_kwargs: [SimpleNamespace(items=items)])
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = model
    monkeypatch.setattr("AI.engines.text.duration", lambda _audio: 10)

    words = aligner.align("vocals.flac", text, "ru")

    assert [word.text for word in words] == ["Ты", "станешь", "слаще", "А", "я"]


def test_long_asr_is_batched_by_vocal_chunks(monkeypatch):
    from AI.engines.text import Qwen3Transcriber

    calls = []
    model = SimpleNamespace(
        transcribe=lambda **kwargs: (
            calls.append(kwargs)
            or [SimpleNamespace(text="первая"), SimpleNamespace(text="вторая")]
        )
    )
    transcriber = Qwen3Transcriber("test-model")
    transcriber._model = model
    chunks = [(np.ones(16000, dtype=np.float32), 16000)] * 2
    monkeypatch.setattr("AI.engines.text._asr_voice_chunks", lambda _audio: chunks)

    text, words = transcriber.transcribe("vocals.flac", "ru")

    assert text == "первая\nвторая"
    assert words == []
    assert calls[0]["audio"] == chunks
    assert calls[0]["language"] == ["Russian", "Russian"]


def test_russian_asr_prefers_fast_ctc_words_without_loading_qwen(monkeypatch):
    from AI.engines.ctc import CTCWordAligner
    from AI.engines.text import Qwen3Transcriber

    direct = [
        Word(index, index + 0.5, token, 0.7, index)
        for index, token in enumerate(("это", "быстрый", "прямой", "текст"))
    ]
    monkeypatch.setenv("KARAOKE_AI_CTC_RU_MODEL", "ctc-model")
    monkeypatch.setattr(CTCWordAligner, "transcribe", lambda _self, _audio: direct)
    transcriber = Qwen3Transcriber("qwen-model")

    text, words = transcriber.transcribe("vocals.flac", "ru")

    assert text == "это быстрый прямой текст"
    assert words == direct
    assert transcriber._model is None


def test_long_alignment_realigns_collapsed_ranges_acoustically(tmp_path, monkeypatch):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 5, dtype=np.float32), 44100)
    collapsed = [
        {"text": token, "start_time": start, "end_time": end}
        for token, start, end in [
            ("one", 0.2, 0.8), ("two", 1, 1), ("three", 1, 1), ("four", 3, 3.6)
        ]
    ]
    repaired = [
        {"text": token, "start_time": index * 0.8, "end_time": index * 0.8 + 0.4}
        for index, token in enumerate(("one", "two", "three", "four"))
    ]

    def align(audio, **_kwargs):
        return [SimpleNamespace(items=repaired if isinstance(audio, tuple) else collapsed)]

    model = SimpleNamespace(align=lambda audio, **kwargs: (
        [SimpleNamespace(items=repaired)] if isinstance(audio, list) else align(audio, **kwargs)
    ))
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = model

    words = aligner.align_long_text(audio, "one two three four", "en")

    assert [(round(word.start, 3), round(word.end, 3)) for word in words] == [
        (0.2, 0.8), (0.8, 1.2), (1.6, 2), (3, 3.6)
    ]


def test_collapsed_ranges_are_repaired_locally_without_losing_acoustic_onset(tmp_path):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 20, dtype=np.float32), 44100)
    initial = [
        ("first", 12.9, 13.7),
        ("short", 13.7, 13.7),
        ("phrase", 13.7, 13.7),
        ("anchor", 15.6, 16.2),
    ]
    repaired = [
        ("first", 1.0, 1.8),
        ("short", 1.8, 2.1),
        ("phrase", 2.1, 2.8),
        ("anchor", 3.7, 4.3),
    ]

    def align(audio, **_kwargs):
        rows = repaired if isinstance(audio, list) else initial
        return [SimpleNamespace(items=[{"text": token, "start_time": start, "end_time": end} for token, start, end in rows]) for _ in audio] if isinstance(audio, list) else SimpleNamespace(items=[{"text": token, "start_time": start, "end_time": end} for token, start, end in rows])

    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(align=align)

    words = aligner.align_long_text(audio, "first short phrase anchor", "en")

    assert words[0].start == 12.9
    assert [(round(word.start, 3), round(word.end, 3)) for word in words[1:3]] == [
        (13.7, 14.0),
        (14.0, 14.7),
    ]


def test_invalid_runs_do_not_merge_across_valid_acoustic_anchors():
    words = [
        Word(1, 2, "one"),
        Word(2, 2, "bad"),
        Word(3, 4, "anchor"),
        Word(4, 4, "bad"),
    ]

    assert _invalid_runs(words, 5) == [(1, 2), (3, 4)]


def test_timed_line_boundary_disagreement_is_clamped_monotonically():
    words = [Word(1.8, 2.0, "first"), Word(1.7, 2.2, "second")]

    _enforce_monotonic_starts(words, 3.0)

    assert (words[1].start, words[1].end) == (1.8, 2.2)


def test_collapsed_multiword_line_expands_inside_its_trusted_lrc_window():
    words = [
        Word(10.0, 10.1, "one", index=0),
        Word(10.1, 10.2, "longer", index=1),
        Word(10.2, 10.3, "three", index=2),
        Word(15.0, 15.5, "next", index=3),
    ]

    _repair_collapsed_timed_lines(words, [(10.0, 0, 3), (15.0, 3, 4)], 20.0)

    assert words[0].start == 10.0
    assert words[2].end == 15.0
    assert all(words[index].end <= words[index + 1].start for index in range(2))
    assert words[3] == Word(15.0, 15.5, "next", index=3)


def test_unresolved_timed_word_repairs_only_its_lrc_line():
    words = [Word(1.1, 1.4, "first", index=0), None, Word(5.1, 5.5, "kept", index=2)]
    entries = [(1.0, 0, 2), (5.0, 2, 3)]

    _fill_unresolved_timed_lines(words, entries, ["first", "missing", "kept"], 8.0)

    assert words[0] == Word(1.1, 1.4, "first", index=0)
    assert words[1] == Word(1.4, 5.0, "missing", 0.0, 1)
    assert words[2] == Word(5.1, 5.5, "kept", index=2)


def test_acoustic_runs_find_words_crossing_silence_and_overlapping_neighbors():
    rate = 100
    samples = np.ones(rate * 5, dtype=np.float32)
    samples[rate * 2:rate * 3] = 0
    words = [
        Word(0.2, 0.8, "clear"),
        Word(1.8, 3.2, "silence"),
        Word(3.3, 4.2, "overlap"),
        Word(4.0, 4.7, "neighbor"),
    ]

    assert _acoustic_runs(words, samples, rate) == [(1, 4)]


def test_ordinary_song_length_uses_a_single_aligner_call_not_windowing(tmp_path):
    # A typical 6-minute song must never hit the windowing path: every
    # attempt to patch window-seam coverage just moved the artifact to the
    # next boundary instead of removing it, so ordinary songs now get one
    # consistent aligner call covering the whole thing instead of being
    # stitched together from several overlapping windows.
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(3600, dtype=np.float32), 10)  # 360s span
    tokens = [f"word{index}" for index in range(10)]

    def align(audio, text, **_kwargs):
        assert audio == str(audio_path)
        assert text == " ".join(tokens)
        return [
            {"text": token, "start_time": index + 0.5, "end_time": index + 0.9}
            for index, token in enumerate(tokens)
        ]

    audio_path = audio
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(align=align)

    words = aligner.align_long_text(audio, " ".join(tokens), "en")

    assert len(words) == len(tokens)
    assert words[0].start == 0.5


def test_only_genuine_outliers_beyond_the_threshold_use_windowing(tmp_path):
    audio = tmp_path / "vocals.flac"
    span_seconds = 610.0  # just over WINDOWED_ALIGNMENT_THRESHOLD_SECONDS (600)
    sf.write(audio, np.zeros(int(span_seconds * 10), dtype=np.float32), 10)
    tokens = [f"word{index}" for index in range(36)]
    calls = []

    def align(audio, text, **_kwargs):
        calls.append((audio, text))
        return [
            SimpleNamespace(items=[
                {
                    "text": token,
                    "start_time": index * 5 + 0.1,
                    "end_time": index * 5 + 0.5,
                }
                for index, token in enumerate(line.split())
            ])
            for line in text
        ]

    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(align=align)
    aligner.align_long_text(audio, " ".join(tokens), "en")

    assert len(calls) == 1
    segments = [len(segment) for segment, _rate in calls[0][0]]
    # Every main window overlaps its neighbour by >=50% (900 samples each),
    # plus a dedicated intro and outro window (450 samples each) appended last.
    assert segments[-2:] == [450, 450]
    assert all(length == 900 for length in segments[:-2])
    assert len(segments) > 2


def test_separation_cancel_stops_worker_immediately():
    class Process:
        alive = True
        exitcode = None

        def is_alive(self): return self.alive
        def join(self, timeout=None): del timeout
        def terminate(self): self.alive = False

    class Queue:
        def put(self, _value): pass
        def put_nowait(self, _value): pass
        def close(self): pass
        def cancel_join_thread(self): pass

    separator = MSSTMelRoformerSeparator()
    process = Process()
    separator._process, separator._requests, separator._results = process, Queue(), Queue()

    with pytest.raises(ProcessingCancelledError):
        separator._run("input", "output", {}, cancelled=lambda: True)

    assert process.alive is False


def test_long_ukrainian_alignment_uses_acoustic_ctc_when_qwen_remains_invalid(
    tmp_path, monkeypatch
):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 4, dtype=np.float32), 44100)
    tokens = ["Заглядай", "у", "очі"]
    model = SimpleNamespace(
        align=lambda **_kwargs: [
            SimpleNamespace(
                items=[
                    {"text": token, "start_time": 0, "end_time": 0} for token in tokens
                ]
            )
        ]
    )
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = model

    class AcousticCTC:
        def __init__(self, model_path):
            assert model_path == "uk-model"

        def align(self, _samples, _rate, canonical, offset):
            # The acoustic CTC model only ever sees a normalized (casefolded,
            # letters-only) transcript — never the canonical mixed-case lyric
            # text — so it can encode every token against its vocabulary.
            assert canonical == [token.casefold() for token in tokens]
            assert offset == 0
            return [
                Word(index + 0.2, index + 0.8, token, 0.9, index)
                for index, token in enumerate(canonical)
            ]

    monkeypatch.setenv("KARAOKE_AI_CTC_UK_MODEL", "uk-model")
    monkeypatch.setattr("AI.engines.ctc.CTCWordAligner", AcousticCTC)

    words = aligner.align_long_text(audio, "Заглядай у очі", "ru")

    assert [(word.text, word.start, word.end) for word in words] == [
        ("Заглядай", 0.2, 0.8),
        ("у", 1.2, 1.8),
        ("очі", 2.2, 2.8),
    ]
    assert aligner.needs_voice_anchoring is False


@pytest.mark.parametrize(
    ("canonical", "timed"),
    [
        ("one two", "one three"),
        ("один два", "один"),
        ("hello", "hello extra"),
        ("don't stop", "do stop"),
    ],
)
def test_timed_line_plan_rejects_non_equivalent_lyrics(canonical, timed):
    with pytest.raises(InvalidArtifactError, match="do not match"):
        _timed_line_plan(canonical, (TimedLine(0, timed),), 10.0)


@pytest.mark.parametrize(
    ("canonical", "timed"),
    [
        ("Hello, WORLD!", "hello world"),
        ("Її пісня", "ЇЇ ПІСНЯ"),
        ("don't stop", "DON'T STOP"),
    ],
)
def test_timed_line_plan_normalization_preserves_equivalent_lyrics(canonical, timed):
    tokens, entries, groups = _timed_line_plan(canonical, (TimedLine(0, timed),), 10.0)
    assert len(tokens) == entries[0][2]
    assert groups == [(0, len(tokens), 0, 10.0)]


def test_timed_line_retry_policy_covers_every_unresolved_position():
    for count in range(1, 9):
        entries = [(0.0, 0, count)]
        for missing in range(count):
            words = [Word(index, index + 0.5, str(index), 1.0, index) for index in range(count)]
            words[missing] = None
            stages = list(_timed_line_retry_stages(words, entries, float(count + 1)))
            assert any(lower <= missing < upper for stage in stages for lower, upper, *_ in stage)


def test_timed_russian_lines_use_one_full_ctc_pass_before_qwen(tmp_path, monkeypatch):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 4, dtype=np.float32), 44100)
    tokens = ["Этот", "парень", "пел"]
    qwen_calls = []
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(align=lambda **kwargs: qwen_calls.append(kwargs))

    class AcousticCTC:
        def __init__(self, model_path):
            assert model_path == "ru-model"

        def align(self, _samples, _rate, canonical, offset):
            assert canonical == [token.casefold() for token in tokens]
            assert offset == 0
            return [
                Word(index + 0.2, index + 0.8, token, 0.9, index)
                for index, token in enumerate(canonical)
            ]

    monkeypatch.setenv("KARAOKE_AI_CTC_RU_MODEL", "ru-model")
    monkeypatch.setattr("AI.engines.ctc.CTCWordAligner", AcousticCTC)

    words = aligner.align_timed_lines(
        audio,
        "Этот парень\nпел",
        (TimedLine(0, "Этот парень"), TimedLine(2, "пел")),
        "ru",
    )

    assert [word.text for word in words] == tokens
    assert qwen_calls == []
    assert aligner.needs_voice_anchoring is False


def test_timed_lines_only_define_acoustic_windows(tmp_path):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 4, dtype=np.float32), 44100)
    items = [
        {"text": token, "start_time": index, "end_time": index + 0.5}
        for index, token in enumerate(("one", "two", "three"))
    ]
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(
        align=lambda **_kwargs: [SimpleNamespace(items=items)]
    )

    words = aligner.align_timed_lines(
        audio, "one two\nthree", (TimedLine(0, "one two"), TimedLine(2, "three")), "en"
    )

    assert [word.text for word in words] == ["one", "two", "three"]


def test_isolated_collapsed_word_uses_remaining_interval_between_acoustic_anchors(tmp_path):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 4, dtype=np.float32), 44100)
    items = [
        {"text": "one", "start_time": 0.2, "end_time": 0.8},
        {"text": "two", "start_time": 1, "end_time": 1},
        {"text": "three", "start_time": 1.4, "end_time": 2},
    ]
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(
        align=lambda audio, **_kwargs: [SimpleNamespace(items=items) for _ in audio]
    )

    words = aligner.align_timed_lines(
        audio, "one two three", (TimedLine(0, "one two three"),), "en"
    )

    assert (words[1].start, words[1].end) == (0.8, 1.4)


def test_collapsed_consonant_preposition_uses_one_model_time_quantum(tmp_path):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(44100 * 3, dtype=np.float32), 44100)
    items = [
        {"text": "sing", "start_time": 0.2, "end_time": 1},
        {"text": "в", "start_time": 1, "end_time": 1},
        {"text": "городе", "start_time": 1, "end_time": 2},
    ]
    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(
        timestamp_segment_time=80,
        align=lambda audio, **_kwargs: [SimpleNamespace(items=items) for _ in audio],
    )

    words = aligner.align_timed_lines(
        audio, "sing в городе", (TimedLine(0, "sing в городе"),), "ru"
    )

    assert (round(words[1].start, 2), round(words[1].end, 2), round(words[2].start, 2)) == (1, 1.08, 1.08)


def test_msst_separator_accepts_flac_vocal_output(tmp_path, monkeypatch):
    engine = tmp_path / "msst"
    engine.mkdir()
    (engine / "inference.py").write_text("# stub", encoding="utf-8")
    config = tmp_path / "config.yaml"
    checkpoint = tmp_path / "model.ckpt"
    config.write_text("stub", encoding="utf-8")
    checkpoint.write_bytes(b"stub")

    mix = tmp_path / "mix.wav"
    vocals = tmp_path / "vocals.flac"
    instrumental = tmp_path / "instrumental.flac"
    audio = np.linspace(-0.2, 0.2, 4410, dtype=np.float32)
    stereo = np.column_stack((audio, audio))
    sf.write(mix, stereo, 44100)

    separator = MSSTMelRoformerSeparator(engine_dir=engine, config=config, checkpoint=checkpoint)

    def fake_run(_source, output, _tuning, **_kwargs):
        stem_dir = output / "song"
        stem_dir.mkdir(parents=True)
        sf.write(stem_dir / "vocals.flac", stereo * 0.75, 44100, subtype="PCM_24")

    monkeypatch.setattr(separator, "_run", fake_run)
    separator.separate(mix, vocals, instrumental)

    vocal_audio, rate = sf.read(vocals, dtype="float32", always_2d=True)
    backing_audio, backing_rate = sf.read(instrumental, dtype="float32", always_2d=True)
    assert rate == backing_rate == 44100
    assert vocal_audio.shape == backing_audio.shape == stereo.shape
    assert np.max(np.abs(vocal_audio)) > 0.1
    assert np.max(np.abs((vocal_audio + backing_audio) - stereo)) < 2e-4


def test_msst_separator_uses_the_backing_stem_directly_without_rereading_the_full_mix(
    tmp_path, monkeypatch
):
    # When MSST produces its own no_vocal/instrumental stem, the instrumental
    # output must come straight from that stem (not from a recomputed
    # mix - vocal, which would need the full mix decoded again). A backing
    # signal deliberately different from mix - vocal makes the two paths
    # distinguishable: matching it only happens if the stem itself was used.
    engine = tmp_path / "msst"
    engine.mkdir()
    (engine / "inference.py").write_text("# stub", encoding="utf-8")
    config = tmp_path / "config.yaml"
    checkpoint = tmp_path / "model.ckpt"
    config.write_text("stub", encoding="utf-8")
    checkpoint.write_bytes(b"stub")

    mix = tmp_path / "mix.wav"
    vocals = tmp_path / "vocals.flac"
    instrumental = tmp_path / "instrumental.flac"
    audio = np.linspace(-0.2, 0.2, 4410, dtype=np.float32)
    stereo = np.column_stack((audio, audio))
    sf.write(mix, stereo, 44100)
    vocal_stem = stereo * 0.75
    backing_stem = stereo * 0.1

    separator = MSSTMelRoformerSeparator(engine_dir=engine, config=config, checkpoint=checkpoint)

    def fake_run(_source, output, _tuning, **_kwargs):
        stem_dir = output / "song"
        stem_dir.mkdir(parents=True)
        sf.write(stem_dir / "vocals.flac", vocal_stem, 44100, subtype="PCM_24")
        sf.write(stem_dir / "no_vocal.flac", backing_stem, 44100, subtype="PCM_24")

    monkeypatch.setattr(separator, "_run", fake_run)

    real_read = sf.read
    read_calls = []

    def counting_read(path, *args, **kwargs):
        read_calls.append(str(path))
        return real_read(path, *args, **kwargs)

    monkeypatch.setattr(sf, "read", counting_read)
    separator.separate(mix, vocals, instrumental)

    backing_audio, backing_rate = sf.read(instrumental, dtype="float32", always_2d=True)
    assert backing_rate == 44100
    assert np.max(np.abs(backing_audio - backing_stem)) < 2e-4
    assert str(mix) not in read_calls


def test_msst_separator_reports_actual_audio_outputs_when_vocal_is_missing(tmp_path, monkeypatch):
    engine = tmp_path / "msst"
    engine.mkdir()
    (engine / "inference.py").write_text("# stub", encoding="utf-8")
    config = tmp_path / "config.yaml"
    checkpoint = tmp_path / "model.ckpt"
    config.write_text("stub", encoding="utf-8")
    checkpoint.write_bytes(b"stub")

    mix = tmp_path / "mix.wav"
    sf.write(mix, np.zeros((1000, 2), dtype=np.float32), 44100)
    separator = MSSTMelRoformerSeparator(engine_dir=engine, config=config, checkpoint=checkpoint)

    def fake_run(_source, output, _tuning, **_kwargs):
        stem_dir = output / "song"
        stem_dir.mkdir(parents=True)
        sf.write(stem_dir / "other.flac", np.zeros((1000, 2), dtype=np.float32), 44100)

    monkeypatch.setattr(separator, "_run", fake_run)
    with pytest.raises(Exception, match=r"audio outputs: song[/\\]other\.flac"):
        separator.separate(mix, tmp_path / "vocals.flac", tmp_path / "instrumental.flac")
