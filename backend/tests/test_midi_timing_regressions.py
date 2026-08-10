from pathlib import Path

import numpy as np
import soundfile as sf

from AI.engines.text import Qwen3ForcedAligner
from AI.models import VocalNote, Word, Syllable
from AI.midi import write_midi
from app.services.ai_bridge import ensure_legacy_artifacts
from app.utils.json_files import read_json, write_json


def test_direct_qwen_alignment_repairs_collapsed_timestamps(tmp_path, monkeypatch):
    audio = tmp_path / "vocals.wav"
    samples = np.zeros(16000 * 2, dtype=np.float32)
    # Two vocal-like activity islands so the fallback has real timing support.
    samples[2400:6400] = 0.2
    samples[9000:13200] = 0.18
    sf.write(audio, samples, 16000)

    class FakeModel:
        def align(self, **_kwargs):
            return [{"items": [
                {"text": "привет", "start_time": 0.8, "end_time": 0.8},
                {"text": "мир", "start_time": 0.8, "end_time": 0.8},
            ]}]

    aligner = Qwen3ForcedAligner()
    monkeypatch.setattr(aligner, "_load", lambda: FakeModel())
    words = aligner.align(audio, "привет мир", "Russian")

    assert len(words) == 2
    assert all(word.end > word.start for word in words)
    assert words[1].start >= words[0].end - 1e-9
    assert words[-1].end - words[0].start > 0.2


def test_legacy_lyrics_preserve_canonical_word_starts(tmp_path):
    write_json(tmp_path / "lyricsSync.json", {
        "text": "первая строка\nвторая строка",
        "words": [
            {"start": 1.25, "end": 1.8, "text": "первая", "confidence": 1.0, "index": 0},
            {"start": 1.82, "end": 2.2, "text": "строка", "confidence": 1.0, "index": 1},
            {"start": 5.4, "end": 5.9, "text": "вторая", "confidence": 1.0, "index": 2},
            {"start": 5.92, "end": 6.4, "text": "строка", "confidence": 1.0, "index": 3},
        ],
    })
    write_json(tmp_path / "songMap.json", {"duration": 10.0, "notes": [], "bpm": 120})
    write_json(tmp_path / "reference.json", {"notes": []})

    ensure_legacy_artifacts(tmp_path)
    lyrics = read_json(tmp_path / "lyrics.json", [])
    starts = [word["start"] for line in lyrics for word in line["words"]]
    assert starts == [1.25, 1.82, 5.4, 5.92]


def test_midi_note_seconds_roundtrip_with_lyrics(tmp_path):
    import mido

    path = tmp_path / "vocal.mid"
    notes = [VocalNote(12.345, 12.812, 69, 100)]
    words = [Word(12.345, 12.8, "тест", 1.0, 0)]
    syllables = [Syllable(12.345, 12.8, "тест", 0, 0, 1.0)]
    write_midi(path, notes, words, syllables, bpm=137.0, pitch_bend=False)

    midi = mido.MidiFile(path)
    tempo = 500000
    absolute_tick = 0
    note_on_tick = None
    lyric_tick = None
    for message in midi.tracks[0]:
        absolute_tick += message.time
        if message.type == "set_tempo":
            tempo = message.tempo
        if message.type == "lyrics":
            lyric_tick = absolute_tick
    absolute_tick = 0
    for message in midi.tracks[1]:
        absolute_tick += message.time
        if message.type == "note_on" and message.velocity:
            note_on_tick = absolute_tick
            break

    assert note_on_tick is not None and lyric_tick is not None
    assert note_on_tick == lyric_tick
    seconds = mido.tick2second(note_on_tick, midi.ticks_per_beat, tempo)
    assert abs(seconds - 12.345) < 0.001
