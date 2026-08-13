from __future__ import annotations

from io import StringIO
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from AI import pipeline
from AI.errors import EngineUnavailableError, InvalidArtifactError, ProcessingCancelledError
from AI.models import PitchFrame, Word


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
    assert pipeline._trim_supplied_text_to_aligned_words("!!!\na", aligned[:1]) == "a"


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
    overlap = words((-0.1, 1, "a", 2), (0.8, 2, "b", -0.1), (1.99, 3.5, "c", 0.5))
    repaired = pipeline._preserve_complete_canonical_timeline(overlap, 3)
    assert repaired and repaired[0].start == 0 and repaired[-1].end == 3
    assert all(0 <= word.confidence <= 1 for word in repaired)
    impossible = words((0, 1, "a", 1), (0, 1, "b", 1), (0, 1, "c", 1))
    assert pipeline._preserve_complete_canonical_timeline(impossible, 0.02) is None


def test_lossless_canonical_words_preserve_or_retime():
    aligned = words((0, 1, "a", 0.8), (1, 2, "b", 0.9))
    assert pipeline._pipeline_lossless_canonical_words("", aligned, 2) is aligned
    assert pipeline._pipeline_lossless_canonical_words("a b", aligned, 2)[0].confidence == 0.8
    retimed = pipeline._pipeline_lossless_canonical_words("long x", aligned[:1], 0.1)
    assert [word.text for word in retimed] == ["long", "x"]
    assert all(word.confidence == 0.004 for word in retimed)
    with pytest.raises(InvalidArtifactError, match="could not be locally"):
        pipeline._pipeline_lossless_canonical_words("a b", aligned, 0.5)


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
