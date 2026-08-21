
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest

from AI.engines import text
from AI.errors import EngineUnavailableError, InvalidArtifactError
from AI.models import PitchFrame, Word
from tests._shared import alignment_result, patch_attrs, patch_many, raises


def make_aligner(monkeypatch):
    monkeypatch.setattr(text.CTCWordAligner, "from_environment", lambda: object())
    return text.Qwen3ForcedAligner()


def make_ctc_engine(**overrides): return SimpleNamespace(**{'release': Mock(), 'last_resource_diagnostics': {}, 'last_alignment_diagnostics': {}, **overrides})


def setup_long_text(monkeypatch, groups):
    aligner = make_aligner(monkeypatch)
    monkeypatch.setattr(text, "_group_lyric_text", lambda _: groups)
    monkeypatch.setitem(sys.modules, "soundfile", SimpleNamespace(write=Mock()))
    return aligner


def disable_ctc(aligner, **overrides):
    aligner._ctc = make_ctc_engine(available_for=lambda *_: False, align_lines=Mock(), **overrides)


def test_transcriber_pitch_activity_and_batch_parsing():
    transcriber, frames = text.Qwen3Transcriber('model'), [PitchFrame(0, 220, 0.9, True), PitchFrame(0.1, 220, 0.9, True), PitchFrame(0.2, 0, 0, False), PitchFrame(0.3, 220, 0.9, True)]
    transcriber.set_pitch_activity(frames[::-1])
    assert (len(transcriber._activity_hints) == 2) and (text.Qwen3Transcriber._parse_batch(None, 1) == [{}]) and (text.Qwen3Transcriber._parse_batch({'text': 'x'}, 2) == [{'text': 'x'}, {}]) and (text.Qwen3Transcriber._parse_batch([{'text': 'x'}], 2) == [{'text': 'x'}, {}])


def test_transcriber_load_cpu_cuda_and_import_error(monkeypatch):
    transcriber = text.Qwen3Transcriber("model")
    monkeypatch.setitem(sys.modules, "qwen_asr", None)
    raises(EngineUnavailableError, lambda: transcriber._load())

    generation = SimpleNamespace(pad_token_id=None, eos_token_id=2)
    loaded = SimpleNamespace(model=SimpleNamespace(generation_config=generation))
    loader, fake_torch = SimpleNamespace(from_pretrained=Mock(return_value=loaded)), SimpleNamespace(float16='f16', float32='f32')
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "qwen_asr", SimpleNamespace(Qwen3ASRModel=loader))
    monkeypatch.setattr(text, "select_torch_device", lambda *_: "cuda:0")
    assert (transcriber._load() is loaded) and (transcriber._call_batch_size == 2 and generation.pad_token_id == 2) and (transcriber._load() is loaded)


def test_transcriber_load_retries_cpu_after_cuda_failure(monkeypatch):
    transcriber, loaded = text.Qwen3Transcriber('model'), SimpleNamespace(model=SimpleNamespace(generation_config=None))
    loader, fake_torch = SimpleNamespace(from_pretrained=Mock(side_effect=[RuntimeError('CUDA OOM'), loaded])), SimpleNamespace(float16='f16', float32='f32')
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "qwen_asr", SimpleNamespace(Qwen3ASRModel=loader))
    patch_attrs(monkeypatch, text, select_torch_device=lambda *_: 'cuda:0', fallback_torch_device=lambda *_: 'cpu')
    assert (transcriber._load() is loaded) and (loader.from_pretrained.call_args_list[-1].kwargs == {'device_map': 'cpu', 'dtype': 'f32', 'max_inference_batch_size': 1, 'max_new_tokens': 256}) and (transcriber._device == 'cpu' and transcriber._call_batch_size == 1)


def test_transcribe_batch_falls_back_to_individual_calls():
    transcriber = text.Qwen3Transcriber()
    assert transcriber._transcribe_batch(Mock(), [], None) == []
    model = Mock()
    model.transcribe.side_effect = [TypeError(), {"text": "a"}, {"text": "b"}]
    assert [item["text"] for item in transcriber._transcribe_batch(model, [1, 2], "en")] == [
        "a",
        "b",
    ]
    model = Mock()
    model.transcribe.return_value = {"text": "single"}
    assert (transcriber._transcribe_batch(model, [1], 'en')[0]['text'] == 'single') and (model.transcribe.call_args.kwargs['language'] == 'English')


def test_transcriber_virtual_and_real_audio(monkeypatch, tmp_path):
    transcriber, model = text.Qwen3Transcriber(), Mock()
    model.transcribe.return_value = {
        "text": " hello ",
        "language": "en",
        "words": [{"text": "hello", "start": 0, "end": 1}],
    }
    monkeypatch.setattr(transcriber, "_load", lambda: model)
    result, timed = transcriber.transcribe(tmp_path / "missing.wav", "en")
    assert result == "hello" and timed and transcriber.last_language == "English"

    audio = tmp_path / "audio.wav"
    audio.touch()
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(100), 10))
    windows = [(np.ones(50), 0.0, 5.0), (np.ones(50), 4.5, 10.0)]
    patch_attrs(monkeypatch, text, _singing_chunk_windows=lambda *_: windows, _transcript_quality=lambda *_: 1)
    transcriber._call_batch_size = 2
    patch_attrs(monkeypatch, transcriber, _transcribe_batch=lambda _model, audios, _language: [{'text': 'one two', 'language': 'en'}, {'text': 'two three', 'language': 'en'}][:len(audios)])
    result, timed = transcriber.transcribe(audio, "en")
    assert result == "one two\nthree" and timed == [] and len(transcriber.last_segments) == 2


def test_transcriber_selective_retries(monkeypatch, tmp_path):
    transcriber = text.Qwen3Transcriber()
    monkeypatch.setattr(transcriber, "_load", lambda: object())
    audio = tmp_path / "audio.wav"
    audio.touch()
    patch_attrs(monkeypatch, text, load_mono=lambda *_: (np.ones(100), 10), _singing_chunk_windows=lambda *_: [(np.ones(100), 0, 10)])
    qualities = iter([0.1, 0.1])
    monkeypatch.setattr(text, "_transcript_quality", lambda *_: next(qualities, 1))
    calls = 0

    def batches(_model, _audios, _language):
        nonlocal calls
        calls += 1
        return [[{"text": "bad", "language": "fr"}], [{"text": "better"}], [{"text": "best"}]][
            calls - 1
        ]

    patch_many(monkeypatch, (transcriber, "_transcribe_batch", batches), (text, "_select_candidate", lambda values, *_: values[-1]))
    result, timed = transcriber.transcribe(audio, "en")
    assert result in {"better", "best"} and timed == [] and calls >= 2


def test_transcriber_pads_missing_batch_results(monkeypatch, tmp_path):
    transcriber = text.Qwen3Transcriber()
    monkeypatch.setattr(transcriber, "_load", lambda: object())
    audio = tmp_path / "audio.wav"
    audio.touch()
    patch_attrs(monkeypatch, text, load_mono=lambda *_: (np.ones(100), 10), _singing_chunk_windows=lambda *_: [(np.ones(50), 0, 5), (np.ones(50), 5, 10)])
    monkeypatch.setattr(transcriber, "_transcribe_batch", lambda *_: [])
    result, timed = transcriber.transcribe(audio, "en")
    assert result == "" and timed == []


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


def test_forced_aligner_setup_load_and_direct_align(monkeypatch, tmp_path):
    monkeypatch.setattr(text.CTCWordAligner, "from_environment", lambda: object())
    aligner = text.Qwen3ForcedAligner("model")
    monkeypatch.setitem(sys.modules, "qwen_asr", None)
    raises(EngineUnavailableError, lambda: aligner._load())

    loader, fake_torch = SimpleNamespace(from_pretrained=Mock(return_value=object())), SimpleNamespace(float16='f16', float32='f32')
    monkeypatch.setitem(sys.modules, "torch", fake_torch)
    monkeypatch.setitem(sys.modules, "qwen_asr", SimpleNamespace(Qwen3ForcedAligner=loader))
    monkeypatch.setattr(text, "select_torch_device", lambda *_: "cpu")
    loaded = aligner._load()
    assert (aligner._load() is loaded) and (loader.from_pretrained.call_args.kwargs['dtype'] == 'f32')

    model = Mock()
    model.align.return_value = []
    monkeypatch.setattr(aligner, "_load", lambda: model)
    raises(InvalidArtifactError, lambda: aligner.align('audio', 'one', 'en'))
    model.align.return_value = [[{"text": "one", "start": 0, "end": 0.01}]]
    monkeypatch.setattr(text, "duration", Mock(side_effect=OSError))
    assert aligner.align("audio", "one", "en")
    patch_attrs(monkeypatch, text, duration=lambda _: 1, load_mono=lambda *_: (np.ones(100), 100), _activity_fallback_words=lambda *_a, **_k: [Word(0, 1, 'one')])
    assert aligner.align("audio", "one", "en")[0].end == 1


def test_align_many_single_batch_and_fallback(monkeypatch):
    aligner = make_aligner(monkeypatch)
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
    aligner, fake_sf = text.Qwen3ForcedAligner(), SimpleNamespace(write=Mock())
    monkeypatch.setitem(sys.modules, "soundfile", fake_sf)
    patch_attrs(monkeypatch, text, load_mono=lambda *_: (np.ones(1000), 100), _adaptive_qwen_batch_size=lambda _: 8)
    candidate = [Word(0, 0.5, "one"), Word(0.5, 1, "two", index=1)]
    monkeypatch.setattr(aligner, "_align_many", lambda *_: [candidate, []])
    segments = [(0, 1, "one two"), (2, 2.01, "three four"), (5, 6, "")]
    result = aligner.align_segments("audio", segments, "en")
    assert ([word.text for word in result] == ['one', 'two', 'three', 'four']) and (fake_sf.write.called)


def test_align_segments_rejects_empty_result_and_missing_soundfile(monkeypatch):
    aligner = make_aligner(monkeypatch)
    monkeypatch.setitem(sys.modules, "soundfile", None)
    raises(EngineUnavailableError, lambda: aligner.align_segments('audio', [], 'en'))
    monkeypatch.setitem(sys.modules, "soundfile", SimpleNamespace(write=Mock()))
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(100), 100))
    raises(InvalidArtifactError, lambda: aligner.align_segments('audio', [(2, 3, 'one')], 'en'))


def test_align_segments_rebuilds_invalid_plausible_fallback(monkeypatch):
    aligner = make_aligner(monkeypatch)
    monkeypatch.setitem(sys.modules, "soundfile", SimpleNamespace(write=Mock()))
    patch_many(monkeypatch, (text, "load_mono", lambda *_: (np.ones(100), 100)), (aligner, "_align_many", lambda *_: [[]]))
    patch_attrs(monkeypatch, text, _timed_segment_fallback_words=lambda *_: [SimpleNamespace(start=0, end=0.005, text='one', confidence=0.1), SimpleNamespace(start=0.005, end=0.01, text='two', confidence=0.1)])
    result = aligner.align_segments("audio", [(0, 1, "one two")], "en")
    assert ([word.text for word in result] == ['one', 'two']) and (result[-1].end - result[0].start >= text._minimum_sung_phrase_duration(['one', 'two']))


def test_align_long_text_uses_exact_full_song_ctc_timestamps(monkeypatch):
    aligner = make_aligner(monkeypatch)
    patch_attrs(monkeypatch, text, load_mono=lambda *_: (np.ones(1000), 100))
    direct = alignment_result(
        (
            Word(1.123456789, 1.523456789, "wrong", 0.8),
            Word(3.234567891, 3.834567891, "wrong", 0.7, 1),
        ),
        0.75,
    )
    align_window = Mock(return_value=direct)
    aligner._ctc = make_ctc_engine(
        available_for=lambda *_: True,
        align_window=align_window,
    )

    words = aligner.align_long_text("vocals.flac", "one\ntwo", "en")

    assert [(word.text, word.start, word.end) for word in words] == [
        ("one", 1.123456789, 1.523456789),
        ("two", 3.234567891, 3.834567891),
    ]
    assert align_window.call_args.args[2] == ["one", "two"]
    assert aligner.last_alignment_diagnostics == {
        "alignment_mode": "full-song-ctc",
        "audio_reference": "vocals",
        "ctc_version": text.CTC_ALIGNMENT_VERSION,
        "word_count": 2,
        "confidence": 0.75,
        "interpolated_words": 0,
    }
    assert aligner._ctc.release.called


def test_align_long_text_preserves_short_and_held_ctc_words(monkeypatch):
    aligner = make_aligner(monkeypatch)
    patch_attrs(monkeypatch, text, load_mono=lambda *_: (np.ones(1000), 100))
    direct = alignment_result(
        (
            Word(1.0, 1.01, "letter", 0.8),
            Word(1.5, 6.5, "held", 0.7, 1),
        ),
        0.75,
    )
    aligner._ctc = make_ctc_engine(
        available_for=lambda *_: True,
        align_window=Mock(return_value=direct),
    )

    words = aligner.align_long_text("vocals.flac", "letter held", "en")

    assert [(word.start, word.end) for word in words] == [(1.0, 1.01), (1.5, 6.5)]
    assert aligner.last_alignment_diagnostics["interpolated_words"] == 0


@pytest.mark.parametrize(
    ("words", "reason"),
    [
        ([Word(1.0, 1.0, "one", 1.0)], "invalid interval"),
        ([Word(9.0, 10.01, "one", 1.0)], "outside vocals"),
        (
            [Word(1.0, 2.0, "one", 1.0), Word(1.9, 2.5, "two", 1.0, 1)],
            "overlaps",
        ),
    ],
)
def test_align_long_text_rejects_only_structurally_invalid_ctc_timestamps(
    monkeypatch, words, reason
):
    aligner = make_aligner(monkeypatch)
    patch_attrs(monkeypatch, text, load_mono=lambda *_: (np.ones(1000), 100))
    monkeypatch.setenv("KARAOKE_AI_REQUIRE_CTC", "1")
    aligner._ctc = make_ctc_engine(
        available_for=lambda *_: True,
        align_window=Mock(return_value=alignment_result(tuple(words), 0.75)),
    )

    raises(
        EngineUnavailableError,
        lambda: aligner.align_long_text(
            "vocals.flac", "one two" if len(words) == 2 else "one", "en"
        ),
        match=reason,
    )


def test_align_long_text_rejects_missing_lyrics_and_short_vocals(monkeypatch):
    aligner = make_aligner(monkeypatch)
    raises(InvalidArtifactError, lambda: aligner.align_long_text("vocals.flac", "", "en"))
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(4), 100))
    raises(
        InvalidArtifactError,
        lambda: aligner.align_long_text("vocals.flac", "one", "en"),
        match="too short",
    )


def test_align_long_text_required_ctc_fails_without_synthetic_timeline(monkeypatch):
    aligner = make_aligner(monkeypatch)
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(1000), 100))
    monkeypatch.setenv("KARAOKE_AI_REQUIRE_CTC", "1")
    aligner._ctc = make_ctc_engine(
        available_for=lambda *_: True,
        align_window=Mock(return_value=None),
    )

    raises(
        EngineUnavailableError,
        lambda: aligner.align_long_text("vocals.flac", "one two", "en"),
        match="returned no words",
    )
    assert aligner._ctc.release.called


def test_align_long_text_uses_raw_full_song_qwen_when_ctc_is_unavailable(monkeypatch):
    aligner = make_aligner(monkeypatch)
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(1000), 100))
    monkeypatch.delenv("KARAOKE_AI_REQUIRE_CTC", raising=False)
    aligner._ctc = make_ctc_engine(available_for=lambda *_: False)
    monkeypatch.setattr(
        aligner,
        "_run_alignment",
        lambda **_: SimpleNamespace(
            words=[
                Word(1.111111111, 1.511111111, "one", 0.8),
                Word(2.222222222, 2.822222222, "two", 0.7, 1),
            ]
        ),
    )

    words = aligner.align_long_text("vocals.flac", "one\ntwo", "en")

    assert [(word.start, word.end) for word in words] == [
        (1.111111111, 1.511111111),
        (2.222222222, 2.822222222),
    ]
    assert aligner.last_alignment_diagnostics["alignment_mode"] == "full-song-qwen"
    assert aligner.last_alignment_diagnostics["interpolated_words"] == 0


def test_align_long_text_rejects_incomplete_qwen_result(monkeypatch):
    aligner = make_aligner(monkeypatch)
    monkeypatch.setattr(text, "load_mono", lambda *_: (np.ones(1000), 100))
    monkeypatch.delenv("KARAOKE_AI_REQUIRE_CTC", raising=False)
    aligner._ctc = make_ctc_engine(available_for=lambda *_: False)
    monkeypatch.setattr(
        aligner,
        "_run_alignment",
        lambda **_: SimpleNamespace(words=[Word(1.0, 1.5, "one", 0.8)]),
    )

    raises(
        InvalidArtifactError,
        lambda: aligner.align_long_text("vocals.flac", "one two", "en"),
        match="canonical lyric invariant",
    )


def test_canonical_alignment_returns_failure_instead_of_asserting_on_incomplete_gap(monkeypatch):
    monkeypatch.setattr(text, "_fill_weighted_gap", lambda *_args, **_kwargs: None)

    words, stats = text._anchor_preserving_canonical_alignment(
        ["one two"],
        [],
        [],
        np.zeros(1_000, dtype=np.float32),
        100,
        10.0,
    )

    assert words == []
    assert stats["interpolated"] == 0
