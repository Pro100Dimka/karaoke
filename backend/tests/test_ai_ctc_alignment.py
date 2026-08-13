from __future__ import annotations

import sys
from contextlib import nullcontext
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from AI.engines import ctc_alignment as ctc
from AI.errors import EngineUnavailableError, InvalidArtifactError
from AI.models import Word


@pytest.mark.parametrize(
    ("language", "text", "expected"),
    [
        ("Russian", "", "ru"),
        ("ua", "", "uk"),
        ("English", "", "en"),
        (None, "українська ї", "uk"),
        (None, "русский", "ru"),
        (None, "hello", "en"),
        (None, "123", ""),
    ],
)
def test_language_detection(language, text, expected):
    assert ctc._language_code(language, text) == expected


def test_duration_and_normalization_helpers():
    assert ctc._expected_duration([]) == 0.5
    assert ctc._expected_duration(["a"]) >= 0.25
    assert ctc._normalize_word(" Héllo! ") == "héllo"


def test_ctc_viterbi_and_word_spans():
    torch = pytest.importorskip("torch")
    emissions = torch.log_softmax(
        torch.tensor(
            [
                [5.0, 1.0, 1.0],
                [1.0, 5.0, 1.0],
                [5.0, 1.0, 1.0],
                [1.0, 1.0, 5.0],
                [5.0, 1.0, 1.0],
            ]
        ),
        dim=-1,
    )
    path, states = ctc._ctc_viterbi_states(emissions, [1, 2], 0)
    assert len(path) == 5 and states == [0, 1, 0, 2, 0]
    aligned, confidence = ctc._word_spans_from_ctc(
        emissions, [1, 2], [[0], [1]], 0, ["one", "two"], 5
    )
    assert [word.text for word in aligned] == ["one", "two"] and confidence > 0.5
    assert ctc._word_spans_from_ctc(emissions, [1], [[0]], 0, ["one"], 0) == ([], 0)
    one_path, _ = ctc._ctc_viterbi_states(emissions[:1], [1], 0)
    assert one_path == [1]
    missing, score = ctc._word_spans_from_ctc(emissions, [1, 2], [[0], []], 0, ["a", "b"], 5)
    assert missing == [] and score == 0
    with pytest.raises(ValueError):
        ctc._ctc_viterbi_states(emissions[0], [1], 0)
    with pytest.raises(ValueError):
        ctc._ctc_viterbi_states(emissions, [], 0)


def test_model_directory_validation(tmp_path):
    model = tmp_path / "model"
    assert ctc.CTCWordAligner._valid_model_dir(model) == (False, "directory does not exist")
    model.mkdir()
    assert ctc.CTCWordAligner._valid_model_dir(model)[1] == "config.json is missing"
    (model / "config.json").touch()
    assert ctc.CTCWordAligner._valid_model_dir(model)[1] == "model weights are missing"
    (model / "model.safetensors").touch()
    assert ctc.CTCWordAligner._valid_model_dir(model)[1] == "processor/tokenizer files are missing"
    (model / "vocab.json").touch()
    assert ctc.CTCWordAligner._valid_model_dir(model) == (True, "ok")


def test_candidate_paths_and_environment_resolution(monkeypatch, tmp_path):
    configured = tmp_path / "configured"
    monkeypatch.setattr(ctc.sys, "_MEIPASS", str(tmp_path / "bundle"), raising=False)
    paths = ctc.CTCWordAligner._candidate_paths("ru", str(configured))
    assert paths[0] == configured and len(paths) == len(set(map(str, paths)))
    assert ctc.CTCWordAligner._candidate_paths("unknown", str(configured)) == [configured]
    monkeypatch.setenv("KARAOKE_AI_CTC_RU_MODEL", str(configured))
    monkeypatch.setattr(ctc.CTCWordAligner, "_resolve_model", Mock(return_value=""))
    instance = ctc.CTCWordAligner.from_environment()
    assert instance.models["ru"] == str(configured)


def test_resolve_and_availability(monkeypatch, tmp_path):
    valid = tmp_path / "valid"
    valid.mkdir()
    monkeypatch.setattr(
        ctc.CTCWordAligner, "_candidate_paths", lambda *_: [tmp_path / "bad", valid]
    )
    monkeypatch.setattr(
        ctc.CTCWordAligner,
        "_valid_model_dir",
        staticmethod(lambda path: (path == valid, "ok" if path == valid else "bad")),
    )
    aligner = ctc.CTCWordAligner({"ru": "configured"})
    assert aligner._resolve_model("ru") == str(valid.resolve())
    assert aligner.available_for("ru")
    monkeypatch.setattr(ctc.CTCWordAligner, "_candidate_paths", lambda *_: [])
    assert not aligner.available_for(None, "123")
    assert not aligner._resolve_model("en")


class Tokenizer:
    pad_token_id = 0
    unk_token_id = 99
    word_delimiter_token_id = 3

    def __call__(self, text, **_):
        values = {"bad": [99], "blank": [0], "": []}.get(text, [1, 2])
        return SimpleNamespace(input_ids=values)


def test_target_ids_and_errors():
    aligner = ctc.CTCWordAligner()
    processor = SimpleNamespace(tokenizer=Tokenizer())
    ids, positions, blank = aligner._target_ids(processor, ["one", "two"])
    assert ids == [1, 2, 3, 1, 2] and positions == [[0, 1], [3, 4]] and blank == 0
    with pytest.raises(InvalidArtifactError, match="normalize"):
        aligner._target_ids(processor, ["!!!"])
    with pytest.raises(InvalidArtifactError, match="represent"):
        aligner._target_ids(processor, ["bad"])
    with pytest.raises(InvalidArtifactError, match="no labels"):
        aligner._target_ids(processor, ["blank"])
    tokenizer = Tokenizer()
    tokenizer.pad_token_id = None
    tokenizer.unk_token_id = None
    tokenizer.word_delimiter_token_id = 0
    assert aligner._target_ids(SimpleNamespace(tokenizer=tokenizer), ["one"])[2] == 0


def test_load_missing_cached_and_import_error(monkeypatch):
    aligner = ctc.CTCWordAligner()
    monkeypatch.setattr(aligner, "_resolve_model", lambda _: "")
    with pytest.raises(EngineUnavailableError, match="No usable"):
        aligner._load("ru")
    aligner._loaded_key = "model"
    aligner._processor = processor = object()
    aligner._model = model = object()
    monkeypatch.setattr(aligner, "_resolve_model", lambda _: "model")
    assert aligner._load("ru") == (processor, model)
    aligner._model = None
    monkeypatch.setitem(sys.modules, "transformers", None)
    with pytest.raises(EngineUnavailableError, match="transformers"):
        aligner._load("ru")


def test_load_standard_lm_fallback_and_unrelated_error(monkeypatch):
    torch = pytest.importorskip("torch")

    class Model:
        def eval(self):
            return self

        def to(self, device):
            self.device = device
            return self

    processor = SimpleNamespace(tokenizer="tokenizer")
    auto_processor = SimpleNamespace(from_pretrained=Mock(return_value=processor))
    model_loader = SimpleNamespace(from_pretrained=Mock(return_value=Model()))
    transformers = SimpleNamespace(
        AutoFeatureExtractor=SimpleNamespace(from_pretrained=Mock(return_value="features")),
        AutoModelForCTC=model_loader,
        AutoProcessor=auto_processor,
        AutoTokenizer=SimpleNamespace(from_pretrained=Mock(return_value="tokens")),
        Wav2Vec2Processor=lambda **kwargs: SimpleNamespace(**kwargs),
    )
    monkeypatch.setitem(sys.modules, "transformers", transformers)
    monkeypatch.setattr(ctc, "select_torch_device", lambda _: "cpu")
    aligner = ctc.CTCWordAligner()
    monkeypatch.setattr(aligner, "_resolve_model", lambda _: "model")
    assert aligner._load("ru")[0] is processor

    aligner.release()
    auto_processor.from_pretrained.side_effect = ImportError("pyctcdecode missing")
    fallback, _ = aligner._load("ru")
    assert fallback.feature_extractor == "features" and fallback.tokenizer == "tokens"

    aligner.release()
    auto_processor.from_pretrained.side_effect = ImportError("unrelated")
    with pytest.raises(ImportError, match="unrelated"):
        aligner._load("ru")
    assert torch is not None


def test_infer_cpu_cuda_and_import_error(monkeypatch):
    torch = pytest.importorskip("torch")

    class Value:
        def to(self, _device):
            return self

    processor = Mock(return_value=SimpleNamespace(input_values=Value(), attention_mask=Value()))
    model = Mock(return_value=SimpleNamespace(logits=torch.ones((1, 3, 4))))
    aligner = ctc.CTCWordAligner()
    monkeypatch.setattr(aligner, "_load", lambda *_: (processor, model))
    aligner._device = "cpu"
    values, returned = aligner._infer(np.zeros(100), 100, "en", "one")
    assert values.shape == (3, 4) and returned is processor
    aligner._device = "cuda:0"
    monkeypatch.setattr(torch, "autocast", lambda **_: nullcontext())
    assert aligner._infer(np.zeros(100), 100, "en", "one")[0].shape == (3, 4)
    monkeypatch.setitem(sys.modules, "torch", None)
    with pytest.raises(EngineUnavailableError, match="torch is required"):
        aligner._infer(np.zeros(100), 100, "en", "one")


def test_release_handles_cuda_and_missing_torch(monkeypatch):
    aligner = ctc.CTCWordAligner()
    aligner._processor = aligner._model = object()
    fake_torch = SimpleNamespace(
        cuda=SimpleNamespace(is_available=lambda: True, empty_cache=Mock())
    )
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    aligner.release()
    assert aligner._model is None and fake_torch.cuda.empty_cache.called
    monkeypatch.setitem(sys.modules, "torch", None)
    aligner.release()


def test_align_window_rejections_and_success(monkeypatch):
    torch = pytest.importorskip("torch")
    aligner = ctc.CTCWordAligner()
    assert aligner.align_window(np.zeros(10), 100, ["word"], "en") is None
    emissions = torch.log_softmax(torch.ones((2, 5)), dim=-1)
    monkeypatch.setattr(aligner, "_infer", lambda *_: (emissions, SimpleNamespace()))
    monkeypatch.setattr(aligner, "_target_ids", lambda *_: ([1, 1], [[0, 1]], 0))
    assert aligner.align_window(np.zeros(400), 100, ["word"], "en") is None
    monkeypatch.setattr(aligner, "_target_ids", lambda *_: ([1], [[0]], 0))
    monkeypatch.setattr(
        ctc,
        "_word_spans_from_ctc",
        lambda *_: ([Word(0, 1, "word", 0.8, 0)], 0.8),
    )
    result = aligner.align_window(np.zeros(400), 100, ["word"], "en")
    assert result and result.confidence == 0.8
    monkeypatch.setattr(ctc, "_word_spans_from_ctc", lambda *_: ([], 0))
    assert aligner.align_window(np.zeros(400), 100, ["word"], "en") is None


def test_align_lines_unavailable_and_anchored_retry(monkeypatch):
    aligner = ctc.CTCWordAligner()
    monkeypatch.setattr(aligner, "available_for", lambda *_: False)
    assert aligner.align_lines("x", ["one", "two"], "en") == [None, None]

    monkeypatch.setattr(aligner, "available_for", lambda *_: True)
    monkeypatch.setattr(ctc, "load_mono", lambda *_: (np.zeros(160000), 16000))
    calls = 0

    def align_window(_audio, _rate, words, _language):
        nonlocal calls
        calls += 1
        if calls == 1:
            return None
        return ctc.CTCLineResult((Word(0, 1, words[0], 0.8, 0),), 0.8, 0, 1)

    monkeypatch.setattr(aligner, "align_window", align_window)
    result = aligner.align_lines("x", ["one", "", "two"], "en", {0: (1, 2, 0.8)})
    assert result[0] and result[1] is None
    assert aligner.last_alignment_diagnostics["retry_recovered_lines"] == 1


def test_align_lines_swallows_window_errors_and_rejects_bad_results(monkeypatch):
    aligner = ctc.CTCWordAligner()
    monkeypatch.setattr(aligner, "available_for", lambda *_: True)
    monkeypatch.setattr(ctc, "load_mono", lambda *_: (np.zeros(16000), 16000))
    monkeypatch.setattr(aligner, "align_window", Mock(side_effect=RuntimeError))
    assert aligner.align_lines("x", ["one"], "en") == [None]
    monkeypatch.setattr(
        aligner,
        "align_window",
        lambda *_: ctc.CTCLineResult((Word(0, 0.001, "one", 0.01, 0),), 0.01, 0, 1),
    )
    assert aligner.align_lines("x", ["one"], "en") == [None]

    calls = []

    def successful(_audio, _rate, words, _language):
        calls.append(words)
        return ctc.CTCLineResult((Word(0, 1, words[0], 0.8, 0),), 0.8, 0, 1)

    monkeypatch.setattr(aligner, "align_window", successful)
    result = aligner.align_lines("x", ["one", "two"], "en", {1: (0.8, 0.9, 0.8)})
    assert result[0] and calls
