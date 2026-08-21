from __future__ import annotations

import math
import statistics


def hz_to_midi(frequency: float) -> float:
    return 69.0 + 12.0 * math.log2(float(frequency) / 440.0)


def midi_to_hz(note: int) -> float:
    return 440.0 * 2.0 ** ((int(note) - 69.0) / 12.0)


def quantize_voiced_points(
    times: list[float],
    frequencies: list[float],
    *,
    minimum_note_seconds: float = 0.07,
) -> list[float]:
    """Lock voiced pitch points to stable semitones without bridging silence."""
    if len(times) != len(frequencies):
        raise ValueError("Pitch times and frequencies must have equal lengths")
    if not times:
        return []
    if any(not math.isfinite(value) for value in (*times, *frequencies)):
        raise ValueError("Pitch points must be finite")
    if any(value <= 0 for value in frequencies):
        raise ValueError("Voiced pitch frequencies must be positive")
    if any(right <= left for left, right in zip(times, times[1:], strict=False)):
        raise ValueError("Pitch times must be strictly increasing")

    gaps = [right - left for left, right in zip(times, times[1:], strict=False) if right > left]
    step = max(0.005, min(0.04, statistics.median(gaps) if gaps else 0.01))
    max_gap = max(0.04, step * 3.5)
    radius = max(1, int(round(0.04 / step)))
    midi = [hz_to_midi(value) for value in frequencies]
    smoothed = list(midi)
    ranges: list[tuple[int, int]] = []
    run_start = 0
    for index in range(1, len(times) + 1):
        if index < len(times) and times[index] - times[index - 1] <= max_gap:
            continue
        ranges.append((run_start, index))
        for point in range(run_start, index):
            smoothed[point] = statistics.median(
                midi[max(run_start, point - radius):min(index, point + radius + 1)]
            )
        run_start = index
    snapped = [max(0, min(127, int(round(value)))) for value in smoothed]

    for run_start, run_end in ranges:
        _merge_micro_pitch_runs(
            snapped,
            smoothed,
            times,
            run_start,
            run_end,
            max(float(minimum_note_seconds), step * 4.0),
            step,
        )
    return [midi_to_hz(note) for note in snapped]


def _segments(values: list[int], start: int, end: int) -> list[tuple[int, int, int]]:
    result: list[tuple[int, int, int]] = []
    cursor = start
    while cursor < end:
        boundary = cursor + 1
        while boundary < end and values[boundary] == values[cursor]:
            boundary += 1
        result.append((cursor, boundary, values[cursor]))
        cursor = boundary
    return result


def _merge_micro_pitch_runs(
    snapped: list[int],
    observed: list[float],
    times: list[float],
    start: int,
    end: int,
    minimum_duration: float,
    step: float,
) -> None:
    if end - start < 2:
        return
    while True:
        groups = _segments(snapped, start, end)
        changed = False
        for index, (left, right, _note) in enumerate(groups):
            duration = times[right - 1] - times[left] + step
            if duration >= minimum_duration or len(groups) == 1:
                continue
            neighbours = []
            if index > 0:
                neighbours.append(groups[index - 1])
            if index + 1 < len(groups):
                neighbours.append(groups[index + 1])
            center = float(statistics.median(observed[left:right]))
            target = min(
                neighbours,
                key=lambda item: (
                    abs(item[2] - center),
                    -(times[item[1] - 1] - times[item[0]] + step),
                ),
            )[2]
            snapped[left:right] = [target] * (right - left)
            changed = True
            break
        if not changed:
            return
