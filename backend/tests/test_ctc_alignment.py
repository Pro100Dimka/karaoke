from __future__ import annotations

import numpy as np
import pytest

from AI.engines.ctc_alignment import (
    CTCLineResult,
    _ctc_viterbi_states,
    _word_spans_from_ctc,
)


def test_ctc_viterbi_aligns_repeated_labels_without_collapsing():
    torch = pytest.importorskip("torch")
    # vocab: blank=0, a=1, b=2. Target a,a requires blank separation.
    probs = torch.full((7, 3), 0.01)
    sequence = [0, 1, 1, 0, 1, 1, 0]
    for frame, label in enumerate(sequence):
        probs[frame, label] = 0.98
    log_probs = torch.log(probs / probs.sum(dim=1, keepdim=True))
    path, _states = _ctc_viterbi_states(log_probs, [1, 1], 0)
    target_states = [state for state in path if state % 2 == 1]
    assert 1 in target_states
    assert 3 in target_states


def test_word_spans_preserve_word_order_and_real_frame_positions():
    torch = pytest.importorskip("torch")
    # blank=0, a=1, delimiter=2, b=3. "a b"
    probs = torch.full((10, 4), 0.002)
    labels = [0, 0, 1, 1, 2, 0, 3, 3, 0, 0]
    for frame, label in enumerate(labels):
        probs[frame, label] = 0.99
    log_probs = torch.log(probs / probs.sum(dim=1, keepdim=True))
    words, confidence = _word_spans_from_ctc(
        log_probs,
        [1, 2, 3],
        [[0], [2]],
        0,
        ["А", "Б"],
        2.0,
    )
    assert len(words) == 2
    assert words[0].start == pytest.approx(0.4, abs=0.21)
    assert words[0].end <= words[1].start
    assert words[1].start == pytest.approx(1.2, abs=0.21)
    assert confidence > 0.7


def test_ctc_model_discovery_falls_back_from_bad_env_path(tmp_path, monkeypatch):
    from AI.engines.ctc_alignment import CTCWordAligner

    bad = tmp_path / "bad"
    bad.mkdir()
    root = tmp_path / "checkout"
    model = root / "downloads" / "models" / "ctc" / "wav2vec2-large-xlsr-53-russian"
    model.mkdir(parents=True)
    (model / "config.json").write_text("{}", encoding="utf-8")
    (model / "model.safetensors").write_bytes(b"x")
    (model / "preprocessor_config.json").write_text("{}", encoding="utf-8")

    monkeypatch.setenv("KARAOKE_AI_CTC_RU_MODEL", str(bad))
    monkeypatch.chdir(root)
    aligner = CTCWordAligner.from_environment()
    assert aligner.available_for("Russian", "Привет") is True
    assert aligner.models["ru"] == str(model.resolve())
    assert aligner.last_resource_diagnostics["ru"]["available"] is True


def test_ctc_model_discovery_exposes_missing_resource_reason(tmp_path, monkeypatch):
    from AI.engines.ctc_alignment import CTCWordAligner

    monkeypatch.chdir(tmp_path)
    monkeypatch.setenv("KARAOKE_AI_CTC_RU_MODEL", str(tmp_path / "missing"))
    aligner = CTCWordAligner.from_environment()
    assert aligner.available_for("Russian", "Привет") is False
    details = aligner.last_resource_diagnostics["ru"]
    assert details["available"] is False
    assert details["checked"]
    assert any("does not exist" in item["reason"] for item in details["checked"])


def test_ctc_load_falls_back_from_lm_processor_without_pyctcdecode(tmp_path, monkeypatch):
    from types import SimpleNamespace
    import sys
    import types

    from AI.engines.ctc_alignment import CTCWordAligner

    model = tmp_path / "model"
    model.mkdir()
    for name in ("config.json", "preprocessor_config.json", "tokenizer_config.json", "vocab.json"):
        (model / name).write_text("{}", encoding="utf-8")
    (model / "model.safetensors").write_bytes(b"x")

    class FakeAutoProcessor:
        @classmethod
        def from_pretrained(cls, *_args, **_kwargs):
            raise ImportError("Wav2Vec2ProcessorWithLM requires the pyctcdecode library")

    feature = object()
    tokenizer = object()

    class FakeAutoFeatureExtractor:
        @classmethod
        def from_pretrained(cls, *_args, **_kwargs):
            return feature

    class FakeAutoTokenizer:
        @classmethod
        def from_pretrained(cls, *_args, **_kwargs):
            return tokenizer

    class FakeProcessor:
        def __init__(self, feature_extractor, tokenizer):
            self.feature_extractor = feature_extractor
            self.tokenizer = tokenizer

    class FakeModel:
        @classmethod
        def from_pretrained(cls, *_args, **_kwargs):
            return cls()
        def eval(self):
            return self
        def to(self, _device):
            return self

    fake_transformers = types.ModuleType("transformers")
    fake_transformers.AutoFeatureExtractor = FakeAutoFeatureExtractor
    fake_transformers.AutoModelForCTC = FakeModel
    fake_transformers.AutoProcessor = FakeAutoProcessor
    fake_transformers.AutoTokenizer = FakeAutoTokenizer
    fake_transformers.Wav2Vec2Processor = FakeProcessor
    monkeypatch.setitem(sys.modules, "transformers", fake_transformers)

    aligner = CTCWordAligner(models={"ru": str(model)})
    monkeypatch.setattr("AI.engines.ctc_alignment.select_torch_device", lambda _torch: "cpu")
    processor, _model = aligner._load("ru", "Привет")
    assert processor.feature_extractor is feature
    assert processor.tokenizer is tokenizer
