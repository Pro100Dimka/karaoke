import math

import numpy as np
import soundfile as sf

from AI.engines.text import Qwen3Transcriber
from AI.models import PitchFrame, Syllable
from AI.notes import build_vocal_notes


class _ASRItem:
    def __init__(self, text, language="Russian"):
        self.text = text
        self.language = language
        self.time_stamps = None


class _BatchASR:
    def __init__(self):
        self.calls = 0
        self.batch_sizes = []

    def transcribe(self, audio, language=None):
        self.calls += 1
        self.batch_sizes.append(len(audio) if isinstance(audio, list) else 1)
        if isinstance(audio, list):
            return [_ASRItem(f"фраза {i}") for i in range(len(audio))]
        return [_ASRItem("короткая фраза")]


def test_long_singing_is_segmented_before_asr(tmp_path, monkeypatch):
    sr = 16000
    # 50 s signal with low-energy valleys every ~16 s.
    t = np.arange(sr * 50, dtype=np.float32) / sr
    y = 0.12 * np.sin(2 * np.pi * 220 * t)
    for center in (16, 32, 47):
        lo = max(0, int((center - 0.35) * sr))
        hi = min(len(y), int((center + 0.35) * sr))
        y[lo:hi] *= 0.01
    wav = tmp_path / "vocals.wav"
    sf.write(wav, y, sr)

    fake = _BatchASR()
    engine = Qwen3Transcriber("fake")
    engine._call_batch_size = 2
    monkeypatch.setattr(engine, "_load", lambda: fake)
    text, words = engine.transcribe(wav, "ru")

    assert fake.calls >= 2
    assert max(fake.batch_sizes) <= 2
    assert text.count("фраза") >= 2
    assert words == []  # chunk-local timestamps intentionally go to forced aligner
    assert engine.last_language == "Russian"


def _frame(time, midi, confidence=0.95, energy=0.1):
    hz = 440.0 * 2 ** ((midi - 69.0) / 12.0)
    return PitchFrame(time, hz, confidence, True, energy)


def test_vibrato_does_not_create_machine_gun_notes():
    syllable = Syllable(0.0, 1.0, "ла", 0, 0, 1.0)
    pitch = []
    for i in range(100):
        time = i * 0.01
        # ±0.58 semitone vibrato around A4: old threshold decoder split this often.
        midi = 69.0 + 0.58 * math.sin(2 * math.pi * 5.5 * time)
        pitch.append(_frame(time, midi))

    notes = build_vocal_notes(pitch, [syllable], split_semitones=0.78)
    assert len(notes) == 1
    assert notes[0].midi_note == 69
    assert len(notes[0].cents) > 3


def test_sustained_melisma_creates_real_note_change():
    syllable = Syllable(0.0, 1.0, "ой", 0, 0, 1.0)
    pitch = []
    for i in range(100):
        time = i * 0.01
        midi = 69.0 if time < 0.48 else 71.0
        pitch.append(_frame(time, midi))

    notes = build_vocal_notes(pitch, [syllable], split_semitones=0.78)
    assert len(notes) == 2
    assert [note.midi_note for note in notes] == [69, 71]


class _SelectiveASR:
    def __init__(self):
        self.calls = []

    def transcribe(self, audio, language=None):
        self.calls.append((audio, language))
        if isinstance(audio, list):
            result = []
            for index in range(len(audio)):
                if index == 0:
                    result.append(_ASRItem("hello wrong language", "English"))
                else:
                    result.append(_ASRItem(f"русская фраза {index}", "Russian"))
            return result
        return [_ASRItem("русская правильная фраза", "Russian")]


def test_selective_asr_retries_language_mismatch_only(tmp_path, monkeypatch):
    sr = 16000
    t = np.arange(sr * 48, dtype=np.float32) / sr
    y = 0.12 * np.sin(2 * np.pi * 220 * t)
    for center in (16, 32):
        lo = int((center - 0.3) * sr)
        hi = int((center + 0.3) * sr)
        y[lo:hi] *= 0.01
    wav = tmp_path / "vocals.wav"
    sf.write(wav, y, sr)

    fake = _SelectiveASR()
    engine = Qwen3Transcriber("fake")
    monkeypatch.setattr(engine, "_load", lambda: fake)
    text, _ = engine.transcribe(wav, None)

    # One batch call + retry for the language-inconsistent chunk. Healthy chunks
    # must not be redundantly reprocessed.
    assert len(fake.calls) >= 2
    assert len(fake.calls) <= 4
    assert "русская правильная фраза" in text
    assert engine.last_language == "Russian"


def test_energy_reattack_splits_repeated_same_pitch_note():
    syllable = Syllable(0.0, 0.8, "ла", 0, 0, 1.0)
    pitch = []
    for i in range(80):
        time = i * 0.01
        energy = 0.12
        if 36 <= i <= 39:
            energy = 0.012
        elif 40 <= i <= 44:
            energy = 0.16
        pitch.append(_frame(time, 69.0, energy=energy))

    notes = build_vocal_notes(pitch, [syllable], split_semitones=0.78)
    assert len(notes) == 2
    assert [note.midi_note for note in notes] == [69, 69]
