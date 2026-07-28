"""
Шаг 10. Построение карты песни.
music.json + reference.json + lyricsSync.json + breaths.json + pitch.json
  -> songMap.json

Собирает единую временную структуру: на каждый момент времени —
текст, ноты, темп, громкость, паузы.
"""
import argparse
import bisect
import json


def load(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def find_current(items, time, start_key="start", end_key="end"):
    """Находит элемент(ы) списка, активные в момент time."""
    return [it for it in items if it[start_key] <= time <= it[end_key]]


def build_song_map(music: dict, reference_notes: list, lyrics_lines: list,
                    breaths: dict, pitch_frames: list) -> dict:
    # Список временных меток — берём из pitch.json (самая частая сетка)
    timeline = []
    note_starts = [n["start"] for n in reference_notes]
    line_starts = [l["start"] for l in lyrics_lines]

    for frame in pitch_frames:
        t = frame["time"]

        # текущая нота (эталон)
        idx = bisect.bisect_right(note_starts, t) - 1
        current_note = None
        if 0 <= idx < len(reference_notes) and reference_notes[idx]["end"] >= t:
            current_note = reference_notes[idx]["note"]

        # текущая строка текста
        idx_l = bisect.bisect_right(line_starts, t) - 1
        current_line = None
        if 0 <= idx_l < len(lyrics_lines) and lyrics_lines[idx_l]["end"] >= t:
            current_line = lyrics_lines[idx_l]["text"]

        # пауза?
        in_pause = any(p["start"] <= t <= p["end"] for p in breaths.get("pauses", []))

        # темп в этот момент (ближайшая точка tempo_curve)
        bpm = music.get("bpm")
        tempo_curve = music.get("tempo_curve", [])
        if tempo_curve:
            closest = min(tempo_curve, key=lambda p: abs(p["time"] - t))
            bpm = closest["bpm"]

        timeline.append({
            "time": round(t, 3),
            "text": current_line,
            "note": current_note,
            "f0_hz": frame.get("f0_hz"),
            "bpm": round(bpm, 1) if bpm else None,
            "loudness_db": frame.get("loudness_db"),
            "pause": in_pause,
        })

    return {
        "key": music.get("key"),
        "time_signature": music.get("time_signature"),
        "bpm": music.get("bpm"),
        "lines": lyrics_lines,
        "notes": reference_notes,
        "pauses": breaths.get("pauses", []),
        "timeline": timeline,
    }


def main():
    parser = argparse.ArgumentParser(description="Сборка общей карты песни")
    parser.add_argument("--music", required=True, help="music.json")
    parser.add_argument("--reference", required=True, help="reference.json")
    parser.add_argument("--lyrics-sync", required=True, help="lyricsSync.json")
    parser.add_argument("--breaths", required=True, help="breaths.json")
    parser.add_argument("--pitch", required=True, help="pitch.json")
    parser.add_argument("output", nargs="?", default="songMap.json")
    args = parser.parse_args()

    music = load(args.music)
    reference_notes = load(args.reference)
    lyrics_lines = load(args.lyrics_sync)
    breaths = load(args.breaths)
    pitch_frames = load(args.pitch)

    song_map = build_song_map(music, reference_notes, lyrics_lines, breaths, pitch_frames)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(song_map, f, ensure_ascii=False, indent=2)

    print(f"Карта песни собрана: {args.output} ({len(song_map['timeline'])} кадров)")


if __name__ == "__main__":
    main()
