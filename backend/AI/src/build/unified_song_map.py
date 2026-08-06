"""Build the frame-by-frame song map consumed by the karaoke player."""

from __future__ import annotations

import argparse
import bisect
from collections.abc import Sequence
from typing import Any

from src.common.json_io import load_json, save_json



def find_current(items, time, start_key="start", end_key="end"):
    """Compatibility helper returning all intervals active at *time*."""
    return [item for item in items if item[start_key] <= time <= item[end_key]]


def _sorted_intervals(items: Sequence[dict[str, Any]]) -> tuple[list[dict[str, Any]], list[float]]:
    ordered = sorted(items, key=lambda item: float(item["start"]))
    return ordered, [float(item["start"]) for item in ordered]


def _active_item(
    items: Sequence[dict[str, Any]], starts: Sequence[float], time: float
) -> dict[str, Any] | None:
    index = bisect.bisect_right(starts, time) - 1
    if index < 0:
        return None
    candidate = items[index]
    return candidate if float(candidate["end"]) >= time else None


def _nearest_bpm(music: dict[str, Any]):
    curve = sorted(music.get("tempo_curve", []), key=lambda point: float(point["time"]))
    times = [float(point["time"]) for point in curve]
    fallback = music.get("bpm")

    def lookup(time: float):
        if not curve:
            return fallback
        index = bisect.bisect_left(times, time)
        if index <= 0:
            return curve[0]["bpm"]
        if index >= len(curve):
            return curve[-1]["bpm"]
        before, after = curve[index - 1], curve[index]
        return before["bpm"] if time - before["time"] <= after["time"] - time else after["bpm"]

    return lookup


def build_song_map(
    music: dict,
    reference_notes: list,
    lyrics_lines: list,
    breaths: dict,
    pitch_frames: list,
) -> dict:
    """Combine independent analysis products into one indexed timeline.

    All interval lookups use binary search.  This matters for long songs where
    checking every pause or lyric line for every 10 ms pitch frame becomes
    noticeably expensive.
    """
    notes, note_starts = _sorted_intervals(reference_notes)
    lines, line_starts = _sorted_intervals(lyrics_lines)
    pauses, pause_starts = _sorted_intervals(breaths.get("pauses", []))
    bpm_at = _nearest_bpm(music)

    timeline = []
    for frame in pitch_frames:
        time = float(frame["time"])
        note = _active_item(notes, note_starts, time)
        line = _active_item(lines, line_starts, time)
        bpm = bpm_at(time)
        timeline.append(
            {
                "time": round(time, 3),
                "text": line.get("text") if line else None,
                "note": note.get("note") if note else None,
                "f0_hz": frame.get("f0_hz"),
                "bpm": round(float(bpm), 1) if bpm is not None else None,
                "loudness_db": frame.get("loudness_db"),
                "pause": _active_item(pauses, pause_starts, time) is not None,
            }
        )

    return {
        "key": music.get("key"),
        "time_signature": music.get("time_signature"),
        "bpm": music.get("bpm"),
        "lines": lyrics_lines,
        "notes": reference_notes,
        "pauses": breaths.get("pauses", []),
        "timeline": timeline,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Сборка общей карты песни")
    parser.add_argument("--music", required=True, help="music.json")
    parser.add_argument("--reference", required=True, help="reference.json")
    parser.add_argument("--lyrics-sync", required=True, help="lyricsSync.json")
    parser.add_argument("--breaths", required=True, help="breaths.json")
    parser.add_argument("--pitch", required=True, help="pitch.json")
    parser.add_argument("output", nargs="?", default="songMap.json")
    args = parser.parse_args()

    song_map = build_song_map(
        load_json(args.music),
        load_json(args.reference),
        load_json(args.lyrics_sync),
        load_json(args.breaths),
        load_json(args.pitch),
    )
    save_json(song_map, args.output)
    print(f"Карта песни собрана: {args.output} ({len(song_map['timeline'])} кадров)")


if __name__ == "__main__":
    main()
