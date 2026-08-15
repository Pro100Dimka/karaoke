from __future__ import annotations

from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from AI import pipeline
from AI.errors import EngineUnavailableError, InvalidArtifactError, ProcessingCancelledError
from AI.models import PitchFrame, Syllable, VocalNote, Word
from AI.quality import QualityReport
from AI.vocal_preprocess import PitchTrackQuality


def words(*items):
    return [
        Word(start, end, text, confidence, index)
        for index, (start, end, text, confidence) in enumerate(items)
    ]


def test_bound_and_trim_canonical_words():
    source = words((0, 10, "x", 0.8), (10, 20, "verylongtoken", 0.8))
    bounded = pipeline._bound_word_durations(source)
    assert bounded[0].end == 0.7 and bounded[1].end <= 13.2
    assert pipeline._trim_supplied_text_to_aligned_words("a\nb c\nd", []) == ""
    assert pipeline._trim_supplied_text_to_aligned_words(" plain ", [source[0]]) == "plain"
    aligned = words((0, 1, "a", 1), (1, 2, "b", 1), (2, 3, "c", 1))
    assert pipeline._trim_supplied_text_to_aligned_words("a\nb c\nd", aligned) == "a\nb c"
    assert pipeline._trim_supplied_text_to_aligned_words("a\nb c", aligned[:2]) == "a"
    assert pipeline._trim_supplied_text_to_aligned_words("!!!\na", aligned[:1]) == "a"
    assert pipeline._trim_supplied_text_to_aligned_words(" \n ", aligned) == ""


def test_canonical_identity_and_publishability():
    aligned = words((0, 1, "Hello", 1), (1, 2, "world", 1))
    assert pipeline._canonical_alignment_matches("hello, world!", aligned)
    assert not pipeline._canonical_alignment_matches("hello", aligned)
    assert not pipeline._canonical_alignment_matches("other world", aligned)
    assert not pipeline._canonical_timeline_is_publishable([], 2)
    assert pipeline._canonical_timeline_is_publishable(aligned, 2)
    invalid = [
        [SimpleNamespace(start=float("nan"), end=1)],
        [SimpleNamespace(start=-1, end=1)],
        [SimpleNamespace(start=0, end=0.001)],
        [SimpleNamespace(start=0, end=3)],
        [SimpleNamespace(start=1, end=2), SimpleNamespace(start=0.5, end=1)],
    ]
    for values in invalid:
        assert not pipeline._canonical_timeline_is_publishable(values, 2)


def test_local_timeline_repair_success_and_rejections():
    assert pipeline._repair_canonical_timeline_locally([], 1) is None
    overlap = words((0, 1, "a", 1), (0.9, 1.5, "b", 1))
    repaired = pipeline._repair_canonical_timeline_locally(overlap, 3)
    assert repaired and repaired[1].start == repaired[0].end and repaired[1].confidence == 0.25
    assert pipeline._repair_canonical_timeline_locally(overlap, 1.2) is None
    huge = words((0, 2, "a", 1), (0, 1, "b", 1))
    assert pipeline._repair_canonical_timeline_locally(huge, 10) is None


def test_preserve_complete_timeline_repairs_bounds_and_suffix():
    assert pipeline._preserve_complete_canonical_timeline([], 1) is None
    overlap = words((0, 1, "a", 1), (0.8, 2, "b", 0), (1.99, 3.5, "c", 0.5))
    repaired = pipeline._preserve_complete_canonical_timeline(overlap, 3)
    assert repaired and repaired[0].start == 0 and repaired[-1].end == 3
    assert all(0 <= word.confidence <= 1 for word in repaired)
    impossible = words((0, 1, "a", 1), (0, 1, "b", 1), (0, 1, "c", 1))
    assert pipeline._preserve_complete_canonical_timeline(impossible, 0.02) is None
    shifted = words((0, 1, "a", 1), (0, 1.02, "b", 1))
    assert pipeline._preserve_complete_canonical_timeline(shifted, 2)[1].start == 0.5
    clipped = words((0, 1, "a", 1), (1.1, 3, "b", 1))
    assert pipeline._preserve_complete_canonical_timeline(clipped, 2)[1].end == 2
    eof = words((1.995, 3, "a", 1))
    assert pipeline._preserve_complete_canonical_timeline(eof, 2)[0].start == 1.99


def test_lossless_canonical_words_preserve_or_retime():
    aligned = words((0, 1, "a", 0.8), (1, 2, "b", 0.9))
    assert pipeline._pipeline_lossless_canonical_words("", aligned, 2) is aligned
    assert pipeline._pipeline_lossless_canonical_words("a b", aligned, 2)[0].confidence == 0.8
    retimed = pipeline._pipeline_lossless_canonical_words("long x", aligned[:1], 0.1)
    assert [word.text for word in retimed] == ["long", "x"]
    assert all(word.confidence == 0.004 for word in retimed)
    with pytest.raises(InvalidArtifactError, match="could not be locally"):
        pipeline._pipeline_lossless_canonical_words("a b", aligned, 0.5)
    reset = pipeline._pipeline_lossless_canonical_words("a b", words((0.09, 0.1, "x", 1)), 0.1)
    assert reset[0].start == 0
    tiny = pipeline._pipeline_lossless_canonical_words(
        "verylongtoken x", words((0, 0.1, "mismatch", 1)), 0.1
    )
    assert tiny[-1].end == 0.1


def test_lossless_words_repair_only_collapsed_transient_span():
    original = words(
        (55.757884630828, 56.240116035786684, "сердце", 0.3333),
        (56.240116035786684, 56.26011603578669, "покой", 0.012),
        (56.24511603578669, 56.26511603578669, "Я", 0.012),
        (56.2651160357867, 56.2851160357867, "в", 0.012),
        (56.28011603578668, 56.43011603578668, "Черты", 0.3),
        (75.76090877868262, 75.82115117411988, "Но", 0.003),
    )
    repaired = pipeline._pipeline_lossless_canonical_words(
        "сердце покой Я в Черты Но",
        original,
        195.54913832199546,
        ["ctc", "interpolated", "interpolated", "reacquired", "reacquired", "qwen"],
    )
    assert repaired[0] == original[0] and repaired[5] == original[5]
    assert [(word.text, word.confidence) for word in repaired] == [
        (word.text, word.confidence) for word in original
    ]
    assert all(left.end <= right.start for left, right in zip(repaired, repaired[1:], strict=False))
    assert repaired[1].start == original[0].end
    assert repaired[4].end == pytest.approx(original[5].start)


class Console(StringIO):
    encoding = "cp1251"

    def __init__(self):
        super().__init__()
        self.reconfigured = False

    def reconfigure(self, **_):
        self.reconfigured = True


def test_lyrics_console_language_and_summary(monkeypatch):
    stream = Console()
    monkeypatch.setattr(pipeline.sys, "__stdout__", stream)
    pipeline._lyrics_console("привет", 2)
    assert stream.reconfigured and "привет 2" in stream.getvalue()
    broken = Mock()
    broken.write.side_effect = OSError("closed")
    monkeypatch.setattr(pipeline.sys, "__stdout__", broken)
    pipeline._lyrics_console("ignored")
    assert pipeline._lyrics_language_hint("Українська їжа є") == "uk"
    assert pipeline._lyrics_language_hint("Русская песня ё") == "ru"
    assert pipeline._lyrics_language_hint("English") is None
    calls = []
    monkeypatch.setattr(pipeline, "_lyrics_console", lambda *parts: calls.append(parts))
    pipeline._print_full_lyrics("source", "a\n\nb", None)
    assert len(calls) == 3


def config(**changes):
    values = {
        "validate_cached_artifacts": True,
        "allow_fallback": False,
        "pitch_sample_rate": 100,
        "hop_seconds": 0.01,
        "fmin_hz": 50,
        "fmax_hz": 500,
    }
    values.update(changes)
    return SimpleNamespace(**values)


def make_pipeline(**changes):
    instance = object.__new__(pipeline.KaraokePipeline)
    instance.config = config(**changes)
    instance.engines = SimpleNamespace()
    return instance


def test_pipeline_init_remove_cache_and_notify(monkeypatch, tmp_path):
    cfg = config()
    engines = object()
    assert pipeline.KaraokePipeline(cfg, engines).engines is engines
    stale = tmp_path / "stale"
    stale.touch()
    pipeline.KaraokePipeline._remove_stale(stale, tmp_path / "missing")
    assert not stale.exists()
    cache = Mock()
    cache.hit.return_value = True
    instance = make_pipeline(validate_cached_artifacts=False)
    assert instance._cache_hit(cache, "s", "k", [], {tmp_path: Mock()})
    assert cache.hit.call_args.kwargs["validators"] is None
    request = pipeline.PipelineRequest("in", "out", progress=Mock())
    instance._notify(request, "stage", 120, "message")
    request.progress.assert_called_once_with("stage", 100, "message")
    with pytest.raises(ProcessingCancelledError):
        instance._notify(pipeline.PipelineRequest("i", "o", cancelled=lambda: True), "s", 0, "m")


def test_pipeline_run_stage_primary_fallback_and_disabled(monkeypatch):
    reports, warnings = [], []
    instance = make_pipeline()
    engine = SimpleNamespace(name="primary")
    assert instance._run("pitch", engine, lambda _: "ok", reports, warnings) == "ok"
    assert reports[-1].engine == "primary"

    instance = make_pipeline(allow_fallback=True)
    fallback = SimpleNamespace(name="fallback")
    monkeypatch.setattr(pipeline, "PyinFallbackPitchEstimator", lambda *_: fallback)
    calls = 0

    def operation(selected):
        nonlocal calls
        calls += 1
        if calls == 1:
            raise EngineUnavailableError("missing")
        return selected.name

    assert instance._run("pitch", engine, operation, reports := [], warnings := []) == "fallback"
    assert warnings == ["missing"] and reports[0].engine == "fallback"
    instance = make_pipeline(allow_fallback=False)
    with pytest.raises(EngineUnavailableError):
        instance._run(
            "pitch", engine, lambda _: (_ for _ in ()).throw(EngineUnavailableError("x")), [], []
        )


def test_publish_alignment_midi_and_run_lock(monkeypatch, tmp_path):
    publish = Mock()
    monkeypatch.setattr(pipeline, "publish_files_atomically", publish)
    monkeypatch.setattr(pipeline, "validate_json", Mock())
    aligned = words((0, 1, "a", 1))
    pipeline.KaraokePipeline._publish_text_alignment(
        tmp_path, tmp_path / "lyrics.txt", tmp_path / "sync.json", "a", aligned
    )
    assert publish.call_count == 1
    monkeypatch.setattr(pipeline, "write_midi", Mock())
    monkeypatch.setattr(pipeline, "validate_midi", Mock())
    pipeline.KaraokePipeline._publish_midi_pair(
        tmp_path, tmp_path / "v.mid", tmp_path / "g.mid", [1], [], aligned, [], 120, 2
    )
    assert publish.call_count == 2
    instance = make_pipeline()
    monkeypatch.setattr(instance, "_run_unlocked", lambda request: "done")
    assert instance.run(pipeline.PipelineRequest("in", tmp_path)) == "done"
    assert pipeline._OutputDirectoryLock(tmp_path).path == tmp_path / ".pipeline.lock"


def test_pipeline_rejects_missing_and_generated_sources(tmp_path):
    instance = make_pipeline()
    with pytest.raises(FileNotFoundError):
        instance._run_unlocked(pipeline.PipelineRequest(tmp_path / "missing.mp3", tmp_path))
    generated = tmp_path / "song.wav"
    generated.write_bytes(b"audio")
    with pytest.raises(ValueError, match="pipeline-generated"):
        instance._run_unlocked(pipeline.PipelineRequest(generated, tmp_path))


@pytest.mark.parametrize(
    "mode",
    [
        "trusted",
        "asr",
        "cached-trusted",
        "cached-asr",
        "long",
        "anchor-fail",
        "segments",
        "cached-segments",
        "variants",
        "explicit",
        "invalid-bpm",
        "source-change",
        "missing-artifact",
        "omnizart",
        "omnizart-fail",
    ],
)
def test_full_pipeline_fresh_supplied_lyrics_flow(monkeypatch, tmp_path, mode):
    trusted_lyrics = mode not in {"asr", "cached-asr"}
    cached = mode.startswith("cached")
    lyric_text = (
        " ".join(f"word{i}" for i in range(60))
        if mode in {"long", "anchor-fail"}
        else "hello world"
    )
    supplied_segments = ((0.0, 2.0, lyric_text),) if mode in {"segments", "cached-segments"} else ()
    source = tmp_path / "source.mp3"
    source.write_bytes(b"source")
    output = tmp_path / "output"
    hash_count = 0

    def source_hash():
        nonlocal hash_count
        hash_count += 1
        return f"hash:{source.name}:{hash_count}"

    class Cache:
        def __init__(self, root):
            self.root = root

        @staticmethod
        def key(stage, payload):
            return f"{stage}:{len(str(payload))}"

        @staticmethod
        def file_hash(path):
            if mode == "source-change" and Path(path) == source:
                return source_hash()
            return f"hash:{Path(path).name}"

        @staticmethod
        def optional_file_hash(path):
            return None if path is None else f"optional:{Path(path).name}"

        def hit(self, stage, _key, outputs, validators=None):
            del validators
            if not cached:
                return False
            for path in outputs:
                path.parent.mkdir(parents=True, exist_ok=True)
                if stage == "tempo":
                    pipeline.write_json_atomic(path, {"bpm": 120, "key": "C"})
                elif stage == "pitch":
                    pipeline.write_json_atomic(
                        path,
                        [
                            {
                                "time": 0,
                                "frequency": 220,
                                "confidence": 0.8,
                                "voiced": True,
                                "energy": 0.1,
                            }
                        ],
                    )
                elif stage in {"alignment", "transcription"}:
                    if path.name == "lyrics.txt":
                        path.write_text(lyric_text + "\n", encoding="utf-8")
                    else:
                        pipeline.write_json_atomic(
                            path,
                            {
                                "text": lyric_text,
                                "words": [
                                    {
                                        "start": 0,
                                        "end": 1,
                                        "text": "hello",
                                        "confidence": 0.8,
                                        "index": 0,
                                    },
                                    {
                                        "start": 1,
                                        "end": 2,
                                        "text": "world",
                                        "confidence": 0.8,
                                        "index": 1,
                                    },
                                ],
                            },
                        )
                elif stage == "derivation":
                    payloads = {
                        "syllables.json": {
                            "syllables": [
                                {"start": 0, "end": 1, "text": "hello", "word_index": 0, "index": 0}
                            ]
                        },
                        "reference.json": {
                            "notes": [
                                {
                                    "start": 0,
                                    "end": 1,
                                    "midi_note": 60,
                                    "word_index": 0,
                                    "syllable_index": 0,
                                }
                            ]
                        },
                        "acousticNotes.json": {
                            "notes": [
                                {
                                    "start": 0,
                                    "end": 1,
                                    "midi_note": 60,
                                    "word_index": 0,
                                    "syllable_index": 0,
                                }
                            ]
                        },
                        "melodyContour.json": {"frames": []},
                    }
                    pipeline.write_json_atomic(path, payloads[path.name])
                elif stage == "song-map":
                    pipeline.write_json_atomic(path, {"duration": 5})
                else:
                    path.write_bytes(stage.encode())
            return True

        @staticmethod
        def commit(*_args, **_kwargs):
            return None

        @staticmethod
        def invalidate(*_args, **_kwargs):
            return None

    monkeypatch.setattr(pipeline, "StageCache", Cache)
    monkeypatch.setattr(
        pipeline,
        "decode_audio",
        lambda _source, target, _rate: target.write_bytes(b"wav") or target,
    )
    monkeypatch.setattr(pipeline, "duration", lambda _: 5.0)
    for name in (
        "validate_audio",
        "validate_pitch",
        "validate_timeline",
        "validate_within_duration",
        "validate_json",
        "validate_midi",
        "validate_music_json",
        "validate_pitch_json",
        "validate_words_json",
        "validate_derivation_json",
    ):
        monkeypatch.setattr(pipeline, name, lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        pipeline,
        "discover_lyrics",
        lambda *_args, **_kwargs: SimpleNamespace(
            text=lyric_text if trusted_lyrics else "",
            segments=supplied_segments,
            source="trusted",
            query="query",
        ),
    )
    separator = SimpleNamespace(
        name="separator",
        config=None,
        checkpoint=None,
        engine_dir=None,
        separate=lambda _mix, vocals, instrumental: (
            vocals.write_bytes(b"vocals"),
            instrumental.write_bytes(b"instrumental"),
        ),
    )
    raw_pitch = [
        PitchFrame(0, 220, 0.8, True, 0.1),
        PitchFrame(0.01, 220, 0.8, True, 0.1),
        PitchFrame(0.02, 220, 0.8, True, 0.1),
    ]
    pitch_engine = SimpleNamespace(
        name="pitch", fingerprint=lambda: {"model": "x"}, estimate=lambda _: raw_pitch
    )
    aligner = SimpleNamespace(
        name="aligner",
        model_name="aligner-model",
        last_alignment_diagnostics={
            "word_sources": ["ctc", "qwen"],
            "word_candidates": [{}, {}],
            "score": 1,
        },
        align=lambda *_: words((0, 1, "hello", 0.8), (1, 2, "world", 0.8)),
        align_segments=lambda *_: words((0, 1, "hello", 0.8), (1, 2, "world", 0.8)),
        align_long_text=lambda *_: [
            Word(index * 0.05, (index + 1) * 0.05, token, 0.8, index)
            for index, token in enumerate(lyric_text.split())
        ],
        set_global_asr_segments=Mock(),
    )
    transcriber = SimpleNamespace(
        name="transcriber",
        model_name="transcriber-model",
        last_language="en",
        last_segments=[(0, 2, "hello world")],
        set_pitch_activity=Mock(),
        transcribe=(
            (lambda *_: (_ for _ in ()).throw(RuntimeError("anchor unavailable")))
            if mode == "anchor-fail"
            else (lambda *_: ("hello world", []))
        ),
        release=Mock(),
    )
    melody = None
    if mode == "omnizart":
        melody = SimpleNamespace(
            name="omnizart-patch-cnn",
            fingerprint=lambda: {"version": "test"},
            estimate=lambda path: raw_pitch if Path(path).name == "song.wav" else [],
        )
    elif mode == "omnizart-fail":
        melody = SimpleNamespace(
            name="omnizart-patch-cnn",
            fingerprint=lambda: {"version": "test"},
            estimate=lambda _path: (_ for _ in ()).throw(EngineUnavailableError("broken")),
        )
    engines = SimpleNamespace(
        separator=separator,
        pitch=pitch_engine,
        aligner=aligner,
        transcriber=transcriber,
        melody=melody,
    )
    cfg = SimpleNamespace(
        sample_rate=44100,
        pitch_sample_rate=16000,
        hop_seconds=0.01,
        fmin_hz=55,
        fmax_hz=1400,
        preserve_raw_pitch=mode != "variants",
        validate_cached_artifacts=True,
        allow_fallback=False,
        min_note_sec=0.05,
        min_voiced_confidence=0.3,
        split_note_semitones=0.8,
        max_gap_sec=0.05,
        midi_bend_range=2,
        write_quality_report=mode != "variants",
    )
    monkeypatch.setattr(
        pipeline,
        "analyze_music",
        lambda _: {"bpm": 120, "key": "C", "tempo_source": "analysis"},
    )

    def cleanup(_source, denoise, tail):
        denoise.write_bytes(b"denoise")
        tail.write_bytes(b"tail")
        return {"denoise": denoise, "tail-suppressed": tail}

    monkeypatch.setattr(pipeline, "prepare_midi_analysis_variants", cleanup)
    monkeypatch.setattr(
        pipeline,
        "score_pitch_track",
        lambda _: PitchTrackQuality(0.8, 1, 0.8, 0, 0, 0),
    )
    monkeypatch.setattr(pipeline, "choose_best_pitch_track", lambda _: "tail-suppressed")
    monkeypatch.setattr(
        pipeline, "refine_pitch_confidence", lambda frames, *_args, **_kwargs: frames
    )
    monkeypatch.setattr(pipeline, "fuse_pitch_with_yin", lambda frames, *_args, **_kwargs: frames)
    stabilizer = Mock(side_effect=lambda frames: frames)
    monkeypatch.setattr(pipeline, "stabilize_pitch", stabilizer)
    syllables = [Syllable(0, 1, "hello", 0, 0), Syllable(1, 2, "world", 1, 1)]
    vocal_notes = [VocalNote(0, 1, 60, word_index=0, syllable_index=0)]
    monkeypatch.setattr(pipeline, "align_syllables", lambda *_: syllables)
    monkeypatch.setattr(
        pipeline,
        "build_vocal_notes",
        lambda *_args, **_kwargs: [] if mode == "variants" else vocal_notes,
    )
    monkeypatch.setattr(pipeline, "get_note_diagnostics", lambda: {"ok": True})
    monkeypatch.setattr(pipeline, "build_game_notes", lambda notes, *_args, **_kwargs: notes)

    def midi_file(path, *_args, **_kwargs):
        Path(path).write_bytes(b"midi")
        return Path(path)

    monkeypatch.setattr(pipeline, "write_midi", midi_file)
    monkeypatch.setattr(pipeline, "build_karaoke_song_map", lambda **_: {"duration": 5})
    monkeypatch.setattr(
        pipeline,
        "evaluate_quality",
        lambda *_: QualityReport(1, 1, 1, 1, 1, 1, 1, ("quality warning",)),
    )
    monkeypatch.setattr(
        pipeline,
        "analyze_vocal_residuals",
        Mock(side_effect=ValueError("diagnostic failed"))
        if mode == "variants"
        else lambda *_: {"available": True},
    )
    monkeypatch.setattr(
        pipeline,
        "build_alignment_debug",
        lambda **_: {
            "health": {},
            "summary": {},
            "suspicious_regions": [],
            "timeline_integrity": {},
            "root_cause_analysis": {},
            "pitch_source_analysis": {},
            "vocal_effect_analysis": {},
            "performance": {},
        },
    )

    def environment_info():
        if mode == "missing-artifact":
            (output / "song.wav").unlink()
        return {"device": "test"}

    monkeypatch.setattr(pipeline, "environment_info", environment_info)
    progress = Mock()
    lyrics_path = None
    if mode == "explicit":
        lyrics_path = tmp_path / "explicit.txt"
        lyrics_path.write_text(lyric_text, encoding="utf-8")
    request = pipeline.PipelineRequest(
        source,
        output,
        title="Українська пісня" if mode == "asr" else "Song",
        progress=progress,
        lyrics_path=lyrics_path,
        bpm_override=10 if mode == "invalid-bpm" else 140 if mode == "variants" else None,
        key_override="Am" if mode == "variants" else None,
    )
    if mode in {"invalid-bpm", "source-change", "missing-artifact"}:
        error = {
            "invalid-bpm": ValueError,
            "source-change": RuntimeError,
            "missing-artifact": FileNotFoundError,
        }[mode]
        with pytest.raises(error):
            pipeline.KaraokePipeline(cfg, engines).run(request)
        return
    result = pipeline.KaraokePipeline(cfg, engines).run(request)
    assert result.manifest_path.exists()
    assert "quality warning" in result.warnings
    assert (output / "songMap.json").exists()
    assert (output / "diagnostics.json").exists()
    performance = pipeline.read_json(output / "performance.json")
    assert performance["elapsed_sec"] >= 0 and performance["stages"]
    assert pipeline.read_json(result.manifest_path)["outputs"]["performance"] == "performance.json"
    assert progress.call_args.args[:2] == ("complete", 100)
    if mode == "omnizart":
        assert any(report.stage == "pitch-primary" for report in result.reports)
        assert not any(report.stage == "pitch-original" for report in result.reports)
        stabilizer.assert_not_called()
    elif mode == "omnizart-fail":
        assert any("FCPE/YIN fallback" in warning for warning in result.warnings)
        assert (output / "separated" / "vocals.midi-analysis.wav").exists()
