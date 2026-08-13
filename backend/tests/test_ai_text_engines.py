from __future__ import annotations

import sys
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from AI.engines import text
from AI.errors import EngineUnavailableError, InvalidArtifactError
from AI.models import PitchFrame, Word


def test_transcriber_pitch_activity_and_batch_parsing():
    transcriber = text.Qwen3Transcriber("model")
    frames = [
        PitchFrame(0, 220, 0.9, True),
        PitchFrame(0.1, 220, 0.9, True),
        PitchFrame(0.2, 0, 0, False),
        PitchFrame(0.3, 220, 0.9, True),
    ]
    transcriber.set_pitch_activity(frames[::-1])
    assert len(transcriber._activity_hints) == 2
    assert text.Qwen3Transcriber._parse_batch(None, 1) == [{}]
    assert text.Qwen3Transcriber._parse_batch({"text": "x"}, 2) == [{"text": "x"}, {}]


def test_transcriber_load_cpu_cuda_and_import_error(monkeypatch):
    transcriber = text.Qwen3Transcriber("model")
    monkeypatch.setitem(sys.modules, "qwen_asr", None)
    with pytest.raises(EngineUnavailableError):
        transcriber._load()

    generation = SimpleNamespace(pad_token_id=None, eos_token_id=2)
    loaded = SimpleNamespace(model=SimpleNamespace(generation_config=generation))
    loader = SimpleNamespace(from_pretrained=Mock(return_value=loaded))
    fake_torch = SimpleNamespace(float16="f16", float32="f32")
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "qwen_asr", SimpleNamespace(Qwen3ASRModel=loader))
    monkeypatch.setattr(text, "select_torch_device", lambda _: "cuda:0")
    assert transcriber._load() is loaded
    assert transcriber._call_batch_size == 2 and generation.pad_token_id == 2
    assert transcriber._load() is loaded


def test_transcribe_batch_falls_back_to_individual_calls():
    transcriber = text.Qwen3Transcriber()
    assert transcriber._transcribe_batch(Mock(), [], None) == []
    model = Mock()
    model.transcribe.side_effect = [TypeError(), {"text": "a"}, {"text": "b"}]
    assert [item["text"] for item in transcriber._transcribe_batch(model, [1, 2], "en")] == [
        "a",
        "b",
    ]


def test_transcriber_virtual_and_real_audio(monkeypatch, tmp_path):
    transcriber = text.Qwen3Transcriber()
    model = Mock()
    model.transcribe.return_value = {
        "text": " hello ",
        "language": "en",
        "words": [{"text": "hello", "start": 0, "end": 1}],
    }
    monkeypatch.setattr(transcriber, "_load", lambda: model)
    result, timed = transcriber.transcribe(tmp_path / "missing.wav", None)
    assert result == "hello" and timed and transcriber.last_language == "English"

    audio = tmp_path / "audio.wav"
    audio.touch()
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(100), 10))
    windows = [(np.ones(50), 0.0, 5.0), (np.ones(50), 4.5, 10.0)]
    monkeypatch.setattr(text, "_singing_chunk_windows", lambda *_: windows)
    monkeypatch.setattr(text, "_transcript_quality", lambda *_: 1)
    transcriber._call_batch_size = 2
    monkeypatch.setattr(
        transcriber,
        "_transcribe_batch",
        lambda _model, audios, _language: [
            {"text": "one two", "language": "en"},
            {"text": "two three", "language": "en"},
        ][: len(audios)],
    )
    result, timed = transcriber.transcribe(audio, "en")
    assert result == "one two three" and timed == [] and len(transcriber.last_segments) == 2


def test_transcriber_selective_retries(monkeypatch, tmp_path):
    transcriber = text.Qwen3Transcriber()
    monkeypatch.setattr(transcriber, "_load", lambda: object())
    audio = tmp_path / "audio.wav"
    audio.touch()
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(100), 10))
    monkeypatch.setattr(text, "_singing_chunk_windows", lambda *_: [(np.ones(100), 0, 10)])
    qualities = iter([0.1, 0.1])
    monkeypatch.setattr(text, "_transcript_quality", lambda *_: next(qualities, 1))
    calls = 0

    def batches(_model, _audios, _language):
        nonlocal calls
        calls += 1
        return [[{"text": "bad", "language": "fr"}], [{"text": "better"}], [{"text": "best"}]][
            calls - 1
        ]

    monkeypatch.setattr(transcriber, "_transcribe_batch", batches)
    monkeypatch.setattr(text, "_select_candidate", lambda values, *_: values[-1])
    result, timed = transcriber.transcribe(audio, "en")
    assert result in {"better", "best"} and timed == [] and calls >= 2


def test_transcriber_release(monkeypatch):
    transcriber = text.Qwen3Transcriber()
    transcriber._model = object()
    fake_torch = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: True, empty_cache=Mock())
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    transcriber.release()
    assert transcriber._model is None and fake_torch.cuda.empty_cache.called
    monkeypatch.setitem(sys.modules, "torch", None)
    transcriber.release()


@pytest.mark.parametrize(
    ("configured", "free_gb", "longest", "expected"),
    [
        ("20", None, 1, 16),
        ("bad", None, 1, 2),
        ("", 8, 5, 8),
        ("", 5, 10, 4),
        ("", 3, 20, 2),
        ("", 1, 20, 1),
    ],
)
def test_adaptive_batch_size(monkeypatch, configured, free_gb, longest, expected):
    monkeypatch.setenv("KARAOKE_AI_ALIGN_BATCH_SIZE", configured)
    if free_gb is not None:
        fake = SimpleNamespace(
            cuda=SimpleNamespace(
                is_available=lambda: True,
                mem_get_info=lambda: (free_gb * 1024**3, 10 * 1024**3),
            )
        )
        monkeypatch.setitem(sys.modules, "torch", fake)
    else:
        monkeypatch.setitem(sys.modules, "torch", None)
    assert text._adaptive_qwen_batch_size([longest]) == expected


def test_line_agreement_score():
    a = [Word(0, 1, "one")]
    assert text._line_agreement_score([], a) == (0, 0)
    assert text._line_agreement_score(a, [Word(0, 1, "two")]) == (0, 0)
    count, score = text._line_agreement_score(a, [Word(0.1, 1.1, "one")])
    assert count == 1 and 0 < score < 1


def test_forced_aligner_setup_load_and_direct_align(monkeypatch, tmp_path):
    monkeypatch.setattr(text.CTCWordAligner, "from_environment", lambda: object())
    aligner = text.Qwen3ForcedAligner("model")
    aligner.set_global_asr_segments([(0, 1, "one"), (1, 1, "bad"), (2, 3, "")])
    assert aligner._global_asr_segments == [(0, 1, "one")]
    monkeypatch.setitem(sys.modules, "qwen_asr", None)
    with pytest.raises(EngineUnavailableError):
        aligner._load()

    model = Mock()
    model.align.return_value = []
    monkeypatch.setattr(aligner, "_load", lambda: model)
    with pytest.raises(InvalidArtifactError):
        aligner.align("audio", "one", "en")
    model.align.return_value = [[{"text": "one", "start": 0, "end": 0.01}]]
    monkeypatch.setattr(text, "duration", Mock(side_effect=OSError))
    assert aligner.align("audio", "one", "en")
    monkeypatch.setattr(text, "duration", lambda _: 1)
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(100), 100))
    monkeypatch.setattr(text, "_activity_fallback_words", lambda *_a, **_k: [Word(0, 1, "one")])
    assert aligner.align("audio", "one", "en")[0].end == 1


def test_align_many_single_batch_and_fallback(monkeypatch):
    monkeypatch.setattr(text.CTCWordAligner, "from_environment", lambda: object())
    aligner = text.Qwen3ForcedAligner()
    assert aligner._align_many([], [], "en") == []
    monkeypatch.setattr(aligner, "align", Mock(return_value=[Word(0, 1, "one")]))
    assert aligner._align_many(["a"], ["one"], "en")[0]
    aligner.align.side_effect = InvalidArtifactError("bad")
    assert aligner._align_many(["a"], ["one"], "en") == [[]]

    model = Mock()
    model.align.return_value = [{"words": [{"text": "one", "start": 0, "end": 1}]}]
    monkeypatch.setattr(aligner, "_load", lambda: model)
    parsed = aligner._align_many(["a", "b"], ["one", "two"], "en")
    assert parsed[0] and parsed[1] == []
    model.align.side_effect = TypeError()
    aligner.align.side_effect = [InvalidArtifactError("bad"), [Word(0, 1, "two")]]
    assert aligner._align_many(["a", "b"], ["one", "two"], "en") == [[], [Word(0, 1, "two")]]


def test_align_segments_candidate_and_fallback(monkeypatch):
    monkeypatch.setattr(text.CTCWordAligner, "from_environment", lambda: object())
    aligner = text.Qwen3ForcedAligner()
    fake_sf = SimpleNamespace(write=Mock())
    monkeypatch.setitem(sys.modules, "soundfile", fake_sf)
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(1000), 100))
    monkeypatch.setattr(text, "_adaptive_qwen_batch_size", lambda _: 8)
    candidate = [Word(0, 0.5, "one"), Word(0.5, 1, "two", index=1)]
    monkeypatch.setattr(aligner, "_align_many", lambda *_: [candidate, []])
    segments = [(0, 1, "one two"), (2, 2.01, "three four"), (5, 6, "")]
    result = aligner.align_segments("audio", segments, "en")
    assert [word.text for word in result] == ["one", "two", "three", "four"]
    assert fake_sf.write.called


def test_align_segments_rejects_empty_result_and_missing_soundfile(monkeypatch):
    monkeypatch.setattr(text.CTCWordAligner, "from_environment", lambda: object())
    aligner = text.Qwen3ForcedAligner()
    monkeypatch.setitem(sys.modules, "soundfile", None)
    with pytest.raises(EngineUnavailableError):
        aligner.align_segments("audio", [], "en")
    monkeypatch.setitem(sys.modules, "soundfile", SimpleNamespace(write=Mock()))
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(100), 100))
    with pytest.raises(InvalidArtifactError):
        aligner.align_segments("audio", [(2, 3, "one")], "en")


def test_align_long_text_single_missing_dependency_and_required_ctc(monkeypatch):
    monkeypatch.setattr(text.CTCWordAligner, "from_environment", lambda: object())
    aligner = text.Qwen3ForcedAligner()
    monkeypatch.setattr(aligner, "align", lambda *_: [Word(0, 1, "one")])
    assert aligner.align_long_text("audio", "one", "en")
    monkeypatch.setattr(text, "_group_lyric_text", lambda _: ["one", "two"])
    monkeypatch.setitem(sys.modules, "soundfile", None)
    with pytest.raises(EngineUnavailableError):
        aligner.align_long_text("audio", "one\ntwo", "en")

    ctc_engine = SimpleNamespace(
        available_for=lambda *_: False,
        align_lines=Mock(),
        release=Mock(),
        last_resource_diagnostics={"ru": {"reason": "missing", "checked": []}},
        last_alignment_diagnostics={},
    )
    aligner._ctc = ctc_engine
    monkeypatch.setitem(sys.modules, "soundfile", SimpleNamespace(write=Mock()))
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(1000), 100))
    monkeypatch.setattr(
        text,
        "_complete_line_anchor_windows",
        lambda *_: ({0: (0, 2, 1), 1: (2, 4, 1)}, {0: "test", 1: "test"}),
    )
    monkeypatch.setenv("KARAOKE_AI_REQUIRE_CTC", "1")
    monkeypatch.setattr(text, "_language_code", lambda *_: "ru")
    with pytest.raises(EngineUnavailableError, match="required"):
        aligner.align_long_text("audio", "one\ntwo", "ru")
    assert ctc_engine.release.called


def test_align_long_text_complete_ctc_and_merge_ranking(monkeypatch):
    monkeypatch.setattr(text.CTCWordAligner, "from_environment", lambda: object())
    aligner = text.Qwen3ForcedAligner()
    groups = ["one two", "three four"]
    monkeypatch.setattr(text, "_group_lyric_text", lambda _: groups)
    monkeypatch.setitem(sys.modules, "soundfile", SimpleNamespace(write=Mock()))
    source = np.ones(1000)
    monkeypatch.setattr(text, "load_mono", lambda *_: (source, 100))
    monkeypatch.setattr(
        text,
        "_complete_line_anchor_windows",
        lambda *_: ({0: (0, 3, 1), 1: (3, 7, 1)}, {0: "test", 1: "test"}),
    )
    ctc_lines = [
        SimpleNamespace(
            words=(Word(0.5, 1, "one", 0.9), Word(1, 1.5, "two", 0.9, 1)),
            confidence=0.9,
        ),
        SimpleNamespace(
            words=(Word(4, 4.5, "three", 0.9), Word(4.5, 5, "four", 0.9, 1)),
            confidence=0.9,
        ),
    ]
    ctc_engine = SimpleNamespace(
        available_for=lambda *_: True,
        align_lines=lambda *_: ctc_lines,
        release=Mock(),
        last_resource_diagnostics={},
        last_alignment_diagnostics={"ok": True},
    )
    aligner._ctc = ctc_engine
    canonical = [word for line in ctc_lines for word in line.words]
    monkeypatch.setattr(
        text,
        "_atomic_line_acoustic_alignment",
        lambda *_a, **_k: (canonical, {"ctc": 4, "qwen": 0, "interpolated": 0}),
    )
    monkeypatch.setattr(
        text,
        "_anchor_preserving_canonical_alignment",
        lambda *_a, **_k: (canonical, {"ctc": 3, "qwen": 0, "interpolated": 1}),
    )
    monkeypatch.setattr(
        text,
        "_line_aware_canonical_alignment",
        lambda *_a, **_k: (canonical, {"ctc": 2, "qwen": 0, "interpolated": 2}),
    )
    result = aligner.align_long_text("audio", "one two\nthree four", "en")
    assert [word.text for word in result] == ["one", "two", "three", "four"]
    assert aligner.last_alignment_diagnostics["alignment_merge_mode"] == "atomic"
