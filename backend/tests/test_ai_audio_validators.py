from __future__ import annotations

import json
import subprocess
from types import SimpleNamespace
from unittest.mock import Mock

import numpy as np
import pytest
import soundfile as sf

from AI import audio, validators
from AI.errors import AICoreError, InvalidArtifactError
from AI.models import PitchFrame, TimeSpan


def dump(path, value):
    path.write_text(json.dumps(value), encoding="utf-8")


def test_load_mono_resamples_and_reports_duration(tmp_path):
    path = tmp_path / "stereo.wav"
    sf.write(path, np.array([[1, -1], [0.5, 0.5]], dtype=np.float32), 8000)
    mono, rate = audio.load_mono(path, 16000)
    assert rate == 16000 and mono.flags.c_contiguous and len(mono) == 4
    unchanged, rate = audio.load_mono(path)
    assert rate == 8000 and len(unchanged) == 2
    assert audio.duration(path) > 0
    with pytest.raises(ValueError, match="positive"):
        audio.load_mono(path, 0)


def test_audio_buffer_cache_reuses_io_but_returns_independent_arrays(monkeypatch, tmp_path):
    path = tmp_path / "audio.wav"
    sf.write(path, np.linspace(-0.5, 0.5, 32, dtype=np.float32), 8000)
    real_read = audio.sf.read
    reads = []

    def counted_read(*args, **kwargs):
        reads.append(args[0])
        return real_read(*args, **kwargs)

    monkeypatch.setattr(audio.sf, "read", counted_read)
    with audio.audio_buffer_cache():
        first, rate = audio.load_mono(path, 16000)
        second, second_rate = audio.load_mono(path, 16000)
        first[0] = 99
        third, _ = audio.load_mono(path, 16000)
    assert rate == second_rate == 16000 and len(reads) == 1
    assert np.array_equal(second, third) and third[0] != 99
    audio.load_mono(path, 16000)
    assert len(reads) == 2


def test_decode_audio_validates_inputs(tmp_path):
    with pytest.raises(FileNotFoundError):
        audio.decode_audio(tmp_path / "missing", tmp_path / "out")
    source = tmp_path / "source"
    source.write_bytes(b"x")
    with pytest.raises(ValueError, match="positive"):
        audio.decode_audio(source, tmp_path / "out", 0)


def test_decode_audio_success(monkeypatch, tmp_path):
    source = tmp_path / "source"
    source.write_bytes(b"x")
    target = tmp_path / "nested" / "out.wav"

    def run(command, **_):
        destination = command[-1]
        with open(destination, "wb") as stream:
            stream.write(b"x" * 44)

    monkeypatch.setattr(audio.subprocess, "run", run)
    monkeypatch.setattr(audio.sf, "info", lambda _: SimpleNamespace(frames=1, samplerate=44100))
    assert audio.decode_audio(source, target) == target and target.exists()


@pytest.mark.parametrize(
    ("failure", "message"),
    [
        (FileNotFoundError(), "not found"),
        (subprocess.TimeoutExpired("ffmpeg", 1), "timeout"),
        (subprocess.CalledProcessError(1, "ffmpeg", stderr=b"bad input"), "bad input"),
        (subprocess.CalledProcessError(1, "ffmpeg", stderr=b""), "without an error"),
        (OSError("read"), "validate decoded"),
    ],
)
def test_decode_audio_wraps_process_failures(monkeypatch, tmp_path, failure, message):
    source = tmp_path / "source"
    source.write_bytes(b"x")
    monkeypatch.setattr(audio.subprocess, "run", Mock(side_effect=failure))
    with pytest.raises(AICoreError, match=message):
        audio.decode_audio(source, tmp_path / "out")


def test_decode_audio_rejects_bad_output(monkeypatch, tmp_path):
    source = tmp_path / "source"
    source.write_bytes(b"x")
    monkeypatch.setattr(audio.subprocess, "run", lambda *_args, **_kwargs: None)
    with pytest.raises(AICoreError, match="valid WAV"):
        audio.decode_audio(source, tmp_path / "out")

    def create(command, **_):
        with open(command[-1], "wb") as stream:
            stream.write(b"x" * 44)

    monkeypatch.setattr(audio.subprocess, "run", create)
    monkeypatch.setattr(audio.sf, "info", lambda _: SimpleNamespace(frames=0, samplerate=1))
    with pytest.raises(AICoreError, match="empty WAV"):
        audio.decode_audio(source, tmp_path / "out")


def test_validate_audio_and_json(monkeypatch, tmp_path):
    path = tmp_path / "audio"
    path.write_bytes(b"x" * 44)
    info = SimpleNamespace(frames=1, samplerate=1, channels=1)
    monkeypatch.setattr(validators.sf, "info", lambda _: info)
    assert validators.validate_audio(path) is info
    for bad in (tmp_path / "missing",):
        with pytest.raises(InvalidArtifactError):
            validators.validate_audio(bad)
    monkeypatch.setattr(validators.sf, "info", Mock(side_effect=RuntimeError("bad")))
    with pytest.raises(InvalidArtifactError, match="Unreadable"):
        validators.validate_audio(path)
    monkeypatch.setattr(
        validators.sf, "info", lambda _: SimpleNamespace(frames=0, samplerate=1, channels=1)
    )
    with pytest.raises(InvalidArtifactError, match="Empty"):
        validators.validate_audio(path)

    payload = tmp_path / "data.json"
    dump(payload, {"ok": 1})
    assert validators.validate_json(payload, ["ok"]) == {"ok": 1}
    dump(payload, [])
    with pytest.raises(InvalidArtifactError, match="object"):
        validators.validate_json(payload)
    dump(payload, {})
    with pytest.raises(InvalidArtifactError, match="required"):
        validators.validate_json(payload, ["missing"])
    payload.write_text("{", encoding="utf-8")
    with pytest.raises(InvalidArtifactError, match="Invalid JSON"):
        validators.validate_json(payload)


@pytest.mark.parametrize(
    "items,message",
    [
        ([SimpleNamespace(start=float("nan"), end=1)], "Non-finite"),
        ([SimpleNamespace(start=-1, end=1)], "Invalid"),
        ([TimeSpan(1, 2), TimeSpan(0, 1)], "not sorted"),
    ],
)
def test_validate_timeline_rejects_invalid(items, message):
    with pytest.raises(InvalidArtifactError, match=message):
        validators.validate_timeline(items)


def test_validate_duration_and_pitch():
    validators.validate_timeline([TimeSpan(0, 1)])
    validators.validate_within_duration([TimeSpan(0, 1.1)], 1, "words")
    with pytest.raises(InvalidArtifactError, match="duration"):
        validators.validate_within_duration([], 0, "words")
    with pytest.raises(InvalidArtifactError, match="outside"):
        validators.validate_within_duration([TimeSpan(0, 2)], 1, "words", -1)
    good = [PitchFrame(0, 440, 0.8, True), PitchFrame(1, 0, 0, False)]
    validators.validate_pitch(good)
    invalid = [
        SimpleNamespace(time=float("nan"), frequency=0, confidence=0, energy=0, voiced=False),
        SimpleNamespace(time=-1, frequency=0, confidence=0, energy=0, voiced=False),
        SimpleNamespace(time=0, frequency=0, confidence=2, energy=0, voiced=False),
        SimpleNamespace(time=0, frequency=0, confidence=1, energy=0, voiced=True),
    ]
    for frame in invalid:
        with pytest.raises(InvalidArtifactError):
            validators.validate_pitch([frame])
    with pytest.raises(InvalidArtifactError, match="not sorted"):
        validators.validate_pitch([good[1], good[0]])


def test_json_domain_validators(tmp_path):
    pitch = tmp_path / "pitch.json"
    dump(pitch, [{"time": 0, "frequency": 440, "confidence": 1, "voiced": True}])
    assert validators.validate_pitch_json(pitch)[0].frequency == 440
    words = tmp_path / "words.json"
    dump(words, {"text": "hi", "words": [{"start": 0, "end": 1, "text": "hi"}]})
    assert validators.validate_words_json(words)[0].text == "hi"
    for kind, key, item in [
        (
            "syllables",
            "syllables",
            {"start": 0, "end": 1, "text": "h", "word_index": 0, "index": 0},
        ),
        ("notes", "notes", {"start": 0, "end": 1, "midi_note": 60}),
        ("frames", "frames", {"time": 0, "frequency": 0, "confidence": 0, "voiced": False}),
    ]:
        path = tmp_path / f"{kind}.json"
        dump(path, {key: [item]})
        assert len(validators.validate_derivation_json(path, kind)) == 1
    dump(pitch, {})
    with pytest.raises(InvalidArtifactError):
        validators.validate_pitch_json(pitch)
    dump(pitch, [{"bad": True}])
    with pytest.raises(InvalidArtifactError):
        validators.validate_pitch_json(pitch)
    dump(pitch, {"syllables": "bad"})
    with pytest.raises(InvalidArtifactError):
        validators.validate_derivation_json(pitch, "syllables")
    dump(pitch, [])
    with pytest.raises(InvalidArtifactError):
        validators.validate_derivation_json(pitch, "syllables")
    with pytest.raises(InvalidArtifactError):
        validators.validate_words_json(pitch)
    dump(pitch, {})
    with pytest.raises(InvalidArtifactError):
        validators.validate_derivation_json(pitch, "unknown")
    with pytest.raises(InvalidArtifactError):
        validators.validate_words_json(pitch)
    dump(pitch, {"text": "hi", "words": [{"bad": True}]})
    with pytest.raises(InvalidArtifactError):
        validators.validate_words_json(pitch)


def test_music_json_validation(tmp_path):
    path = tmp_path / "music.json"
    dump(path, {"bpm": 120})
    assert validators.validate_music_json(path) == 120
    for bpm in ("bad", 10, float("inf")):
        dump(path, {"bpm": bpm})
        with pytest.raises(InvalidArtifactError):
            validators.validate_music_json(path)
