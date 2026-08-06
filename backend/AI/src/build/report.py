"""Create a human-readable Markdown summary for one generated song project."""

from __future__ import annotations

import argparse
from pathlib import Path
from typing import Any

from src.common.json_io import load_json


def _load_optional(path: Path, default):
    return load_json(path) if path.is_file() else default


def _load_if_exists(path: Path):
    """Backward-compatible optional JSON loader used by older callers."""
    return _load_optional(Path(path), None)


def _append_general(lines: list[str], info: dict[str, Any]) -> None:
    lines.extend(("## Общая информация",))
    if info:
        duration = info.get("duration_sec")
        duration_text = f"{int(duration // 60)}:{int(duration % 60):02d}" if duration else "?"
        lines.extend(
            (
                f"- Длительность: {duration_text}",
                f"- Формат исходника: {info.get('format', '?')}, "
                f"{info.get('sample_rate_hz', '?')} Hz, {info.get('channels', '?')} канал(ов)",
            )
        )
    lines.append("")


def _append_music(lines: list[str], music: dict[str, Any]) -> None:
    lines.append("## Музыка")
    if music:
        lines.extend(
            (
                f"- BPM: **{music.get('bpm', '?')}** "
                f"(сырое значение до коррекции: {music.get('bpm_raw', '?')})",
                f"- Тональность: **{music.get('key', '?')}** "
                f"(уверенность {music.get('key_confidence', '?')})",
                f"- Размер такта: {music.get('time_signature', '?')} "
                f"(уверенность {music.get('time_signature_confidence', '?')}, "
                f"{music.get('time_signature_note', '')})",
            )
        )
        candidates = music.get("key_candidates", [])
        if len(candidates) > 1:
            alternatives = ", ".join(
                f"{candidate['key']} ({candidate['score']})" for candidate in candidates[1:]
            )
            lines.append(
                f"  - другие варианты: {alternatives} — если счёт близок к победителю, "
                "тональность стоит проверить на слух"
            )
        changes = music.get("key_changes", [])
        if len(changes) > 1:
            lines.append(f"- Смен тональности: {len(changes) - 1}")
            lines.extend(f"  - {change['time']:.1f}s -> {change['key']}" for change in changes[1:])
    lines.append("")


def _append_vocal(lines: list[str], notes: list[dict], breaths: dict[str, Any]) -> None:
    lines.append("## Вокал")
    if notes:
        durations = [float(note["duration"]) for note in notes]
        lines.extend(
            (
                f"- Всего нот: {len(notes)}",
                f"- Средняя длительность ноты: {sum(durations) / len(durations):.2f} сек",
            )
        )
    if breaths:
        pauses = breaths.get("pauses", [])
        lines.extend(
            (
                f"- Фраз (по паузам): {len(breaths.get('phrases', []))}",
                f"- Вдохов обнаружено: {sum(p.get('type') == 'breath' for p in pauses)}, "
                f"концов фраз: {sum(p.get('type') == 'phrase_end' for p in pauses)}",
            )
        )
        if "top_db_used" in breaths:
            lines.append(f"- Порог тишины (адаптивный): {breaths['top_db_used']} дБ")
    lines.append("")


def _append_difficulty(lines: list[str], difficulty: list[dict], structured: list[dict]) -> None:
    if difficulty:
        values = [section["difficulty"] for section in difficulty if section.get("difficulty")]
        lines.append("## Сложность (по строкам текста)")
        lines.append(
            f"- Средняя сложность: **{sum(values) / len(values):.1f}/10**"
            if values
            else "- Нет данных"
        )
        hardest = max(difficulty, key=lambda section: section.get("difficulty") or 0, default=None)
        if hardest:
            lines.append(
                f"- Самая сложная строка: \"{hardest.get('text', '?')}\" "
                f"({hardest['difficulty']}/10, диапазон {hardest.get('range', '?')})"
            )
        lines.append("")
    if structured:
        lines.append("## Сложность (по структурным блокам)")
        lines.extend(
            f"- {section.get('label', '?')} ({section['start']:.0f}s-{section['end']:.0f}s): "
            f"сложность {section.get('difficulty', '?')}/10, диапазон {section.get('range', '?')}"
            for section in structured
        )
        lines.append("")


def build_report(project_dir: str) -> str:
    directory = Path(project_dir)
    song_info = _load_optional(directory / "songInfo.json", {})
    music = _load_optional(directory / "music.json", {})
    notes = _load_optional(directory / "reference.json", [])
    difficulty = _load_optional(directory / "difficulty.json", [])
    structured = _load_optional(directory / "difficultyByStructure.json", [])
    breaths = _load_optional(directory / "breaths.json", {})
    lyrics = _load_optional(directory / "lyricsSync.json", [])

    lines = [f"# Отчёт по песне: {directory.name}", ""]
    _append_general(lines, song_info)
    _append_music(lines, music)
    _append_vocal(lines, notes, breaths)
    lines.extend(("## Текст", f"- Строк распознано/синхронизировано: {len(lyrics)}" if lyrics else "", ""))
    _append_difficulty(lines, difficulty, structured)
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Сборка отчёта по проекту песни")
    parser.add_argument("project_dir")
    parser.add_argument("output", nargs="?", default=None)
    args = parser.parse_args()
    output = Path(args.output) if args.output else Path(args.project_dir) / "report.md"
    output.write_text(build_report(args.project_dir), encoding="utf-8")
    print(f"Отчёт сохранён: {output}")


if __name__ == "__main__":
    main()
