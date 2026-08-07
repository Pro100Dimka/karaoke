from __future__ import annotations

import math
import statistics

from .models import PitchFrame, Syllable, VocalNote


def hz_to_midi(hz):
    return 69 + 12 * math.log2(hz / 440.0)


def _segments(frames, threshold=0.72, max_gap=0.05, min_confidence=0.42):
    usable = [
        frame
        for frame in frames
        if frame.voiced
        and frame.frequency > 0
        and frame.confidence >= min_confidence
    ]
    if not usable:
        return []
    segments = []
    current = [usable[0]]
    for frame in usable[1:]:
        center = statistics.median(hz_to_midi(item.frequency) for item in current[-9:])
        gap = frame.time - current[-1].time
        distance = abs(hz_to_midi(frame.frequency) - center)
        if gap > max_gap or distance >= threshold:
            segments.append(current)
            current = [frame]
        else:
            current.append(frame)
    segments.append(current)
    return segments


def build_vocal_notes(
    pitch: list[PitchFrame],
    syllables: list[Syllable],
    min_note=0.055,
    split_semitones=0.72,
    max_gap=0.05,
    min_confidence=0.42,
) -> list[VocalNote]:
    output = []
    # Cursor-based slicing avoids rescanning the entire pitch list for every syllable.
    frames = sorted(pitch, key=lambda frame: frame.time)
    cursor = 0
    for syllable in syllables:
        while cursor < len(frames) and frames[cursor].time < syllable.start:
            cursor += 1
        end_cursor = cursor
        while end_cursor < len(frames) and frames[end_cursor].time <= syllable.end:
            end_cursor += 1
        syllable_frames = frames[cursor:end_cursor]
        for segment in _segments(
            syllable_frames,
            threshold=split_semitones,
            max_gap=max_gap,
            min_confidence=min_confidence,
        ):
            start = max(syllable.start, segment[0].time)
            step = segment[-1].time - segment[-2].time if len(segment) > 1 else 0.01
            end = min(syllable.end, segment[-1].time + max(0.005, step))
            if end - start < min_note:
                continue
            midi_values = [hz_to_midi(frame.frequency) for frame in segment]
            base = int(round(statistics.median(midi_values)))
            cents = tuple(
                (frame.time - start, (hz_to_midi(frame.frequency) - base) * 100)
                for frame in segment
            )
            confidence = statistics.mean(frame.confidence for frame in segment)
            velocity = max(35, min(120, int(65 + confidence * 45)))
            output.append(
                VocalNote(
                    start,
                    end,
                    base,
                    velocity,
                    syllable.word_index,
                    syllable.index,
                    cents,
                )
            )
    ordered = sorted(output, key=lambda note: (note.start, note.end))
    monophonic: list[VocalNote] = []
    for note in ordered:
        if monophonic and note.start < monophonic[-1].end:
            previous = monophonic[-1]
            trimmed_end = max(previous.start, note.start)
            if trimmed_end - previous.start >= min_note:
                monophonic[-1] = VocalNote(
                    previous.start,
                    trimmed_end,
                    previous.midi_note,
                    previous.velocity,
                    previous.word_index,
                    previous.syllable_index,
                    tuple((time, cents) for time, cents in previous.cents if time <= trimmed_end - previous.start),
                )
            else:
                monophonic.pop()
        monophonic.append(note)
    return monophonic


def build_game_notes(vocal: list[VocalNote], min_note=0.08) -> list[VocalNote]:
    output = []
    for note in vocal:
        clean = VocalNote(
            note.start,
            note.end,
            int(note.midi_note),
            note.velocity,
            note.word_index,
            note.syllable_index,
            (),
        )
        if (
            output
            and clean.word_index == output[-1].word_index
            and clean.syllable_index == output[-1].syllable_index
            and clean.midi_note == output[-1].midi_note
            and clean.start - output[-1].end < 0.05
        ):
            previous = output[-1]
            output[-1] = VocalNote(
                previous.start,
                clean.end,
                previous.midi_note,
                max(previous.velocity, clean.velocity),
                previous.word_index,
                previous.syllable_index,
                (),
            )
        elif clean.end - clean.start >= min_note:
            output.append(clean)
    return output
