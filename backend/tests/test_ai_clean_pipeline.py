from types import SimpleNamespace

import numpy as np
import pytest
import soundfile as sf

from AI.artifacts import publish_files_atomically
from AI.engines.separation import MSSTMelRoformerSeparator
from AI.engines.text import Qwen3ForcedAligner, _invalid_runs, resolve_alignment_language, tokenize
from AI.errors import ProcessingCancelledError
from AI.lyrics_sources import TimedLine, _expand_notation, discover_lyrics
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


def test_long_alignment_uses_model_window_and_acoustic_confidence(tmp_path):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(1880, dtype=np.float32), 10)
    tokens = [f"word{index}" for index in range(10)]

    def align(audio, text, **_kwargs):
        assert all(len(segment) == 1800 for segment, _rate in audio)
        assert text == [" ".join(tokens), " ".join(tokens)]
        return [
            SimpleNamespace(items=[
                {"text": token, "start_time": index + 0.5, "end_time": index + 0.9,
                 "confidence": confidence}
                for index, token in enumerate(tokens)
            ])
            for confidence in (0.1, 0.9)
        ]

    aligner = Qwen3ForcedAligner("test-model")
    aligner._model = SimpleNamespace(align=align)

    words = aligner.align_long_text(audio, " ".join(tokens), "en")

    assert words[0].start == 8.5
    assert all(word.confidence == 0.9 for word in words)


def test_six_minute_alignment_uses_two_model_windows(tmp_path):
    audio = tmp_path / "vocals.flac"
    sf.write(audio, np.zeros(3600, dtype=np.float32), 10)
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
    assert len(calls[0][0]) == 2
    assert all(len(segment) == 1800 for segment, _rate in calls[0][0])


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
            assert canonical == tokens
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
