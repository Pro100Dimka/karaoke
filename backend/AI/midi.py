from __future__ import annotations

import os
import tempfile
from pathlib import Path

import mido

from .errors import InvalidArtifactError
from .models import Syllable, VocalNote, Word

TICKS_PER_BEAT = 960


def _ticks(seconds: float, tempo: int) -> int: return int(round(mido.second2tick(max(0.0, seconds), TICKS_PER_BEAT, tempo)))


def _append_bend_range(track: mido.MidiTrack, semitones: int) -> None:
    value = max(1, min(24, int(semitones)))
    track.extend(
        [
            mido.Message("control_change", control=101, value=0, time=0),
            mido.Message("control_change", control=100, value=0, time=0),
            mido.Message("control_change", control=6, value=value, time=0),
            mido.Message("control_change", control=38, value=0, time=0),
            mido.Message("control_change", control=101, value=127, time=0),
            mido.Message("control_change", control=100, value=127, time=0),
        ]
    )


def _append_absolute_events(
    track: mido.MidiTrack, events: list[tuple[int, int, mido.Message]]
) -> None:
    previous_tick = 0
    for tick, _, message in sorted(events, key=lambda event: (event[0], event[1])):
        message.time = max(0, tick - previous_tick); track.append(message); previous_tick = tick


def write_midi(
    path: str | Path,
    notes: list[VocalNote],
    words: list[Word],
    syllables: list[Syllable],
    bpm: float = 120.0,
    pitch_bend: bool = True,
    bend_range: int = 2,
) -> Path:
    if not notes: raise InvalidArtifactError("Cannot write MIDI without notes")

    target = Path(path); target.parent.mkdir(parents=True, exist_ok=True); tempo, midi, meta_track = mido.bpm2tempo(max(20.0, min(300.0, float(bpm)))), mido.MidiFile(type=1, ticks_per_beat=TICKS_PER_BEAT, charset='utf-8'), mido.MidiTrack(); midi.tracks.append(meta_track)
    meta_track.append(mido.MetaMessage("track_name", name="Lyrics", time=0)); meta_track.append(mido.MetaMessage("set_tempo", tempo=tempo, time=0))
    text_events = [
        (_ticks(word.start, tempo), 0, mido.MetaMessage("lyrics", text=word.text, time=0))
        for word in words
    ] + [
        (_ticks(syllable.start, tempo), 1, mido.MetaMessage("marker", text=f"SYL:{syllable.text}", time=0))
        for syllable in syllables
    ]
    _append_absolute_events(meta_track, text_events); meta_track.append(mido.MetaMessage("end_of_track", time=0))

    note_track = mido.MidiTrack(); midi.tracks.append(note_track); note_track.append(mido.MetaMessage("track_name", name="Vocal Melody", time=0)); note_track.append(mido.Message("program_change", program=53, time=0))
    if pitch_bend: _append_bend_range(note_track, bend_range)

    note_events: list[tuple[int, int, mido.Message]] = []
    for note in notes:
        start_tick = _ticks(note.start, tempo); end_tick = max(start_tick + 1, _ticks(note.end, tempo)); midi_note = max(0, min(127, int(note.midi_note))); velocity = max(1, min(127, int(note.velocity)))
        note_events.append(
            (start_tick, 2, mido.Message("note_on", note=midi_note, velocity=velocity, time=0))
        )

        if pitch_bend:
            previous_tick = -1; previous_value = None
            for relative_time, cents in note.cents:
                tick = max(start_tick, min(end_tick, _ticks(note.start + relative_time, tempo)))
                value = max(
                    -8192,
                    min(8191, int(round(cents / (100 * max(1, bend_range)) * 8192))),
                )
                if tick == previous_tick or value == previous_value: continue
                note_events.append((tick, 1, mido.Message("pitchwheel", pitch=value, time=0))); previous_tick = tick; previous_value = value

        note_events.append(
            (end_tick, 0, mido.Message("note_off", note=midi_note, velocity=0, time=0))
        )
        if pitch_bend: note_events.append((end_tick, 1, mido.Message("pitchwheel", pitch=0, time=0)))

    _append_absolute_events(note_track, note_events); note_track.append(mido.MetaMessage("end_of_track", time=0))

    descriptor, temporary = tempfile.mkstemp(
        prefix=f"{target.name}.", suffix=".tmp", dir=target.parent
    )
    os.close(descriptor)
    try:
        midi.save(temporary); validate_midi(temporary); os.replace(temporary, target)
    finally: Path(temporary).unlink(missing_ok=True)
    return target


def validate_midi(path: str | Path) -> None:
    source = Path(path)
    try:
        midi = mido.MidiFile(source, charset="utf-8"); note_count = 0
        for track in midi.tracks:
            absolute_tick = 0
            for message in track:
                if message.time < 0: raise ValueError("negative delta time")
                absolute_tick += message.time
                if message.type == "note_on" and message.velocity > 0: note_count += 1
    except (OSError, EOFError, ValueError, TypeError) as exc: raise InvalidArtifactError(f"Invalid MIDI {source}: {exc}") from exc

    if len(midi.tracks) < 2 or note_count < 1:
        raise InvalidArtifactError(
            f"MIDI lacks required tracks/notes: tracks={len(midi.tracks)}, notes={note_count}"
        )
