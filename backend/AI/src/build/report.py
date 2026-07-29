"""
Дополнительный шаг. Человекочитаемый отчёт по песне.
Все json-файлы проекта -> report.md

Собирает ключевые цифры в один markdown-файл, чтобы не открывать
десяток json-ов вручную для быстрой проверки результата.
"""
import argparse
import json
from pathlib import Path


def _load_if_exists(path: Path):
    if path and Path(path).exists():
        with open(path, "r", encoding="utf-8") as f:
            return json.load(f)
    return None


def build_report(project_dir: str) -> str:
    d = Path(project_dir)

    song_info = _load_if_exists(d / "songInfo.json") or {}
    music = _load_if_exists(d / "music.json") or {}
    reference_notes = _load_if_exists(d / "reference.json") or []
    difficulty = _load_if_exists(d / "difficulty.json") or []
    difficulty_by_structure = _load_if_exists(d / "difficultyByStructure.json") or []
    breaths = _load_if_exists(d / "breaths.json") or {}
    lyrics_sync = _load_if_exists(d / "lyricsSync.json") or []

    lines = []
    lines.append(f"# Отчёт по песне: {d.name}")
    lines.append("")

    lines.append("## Общая информация")
    if song_info:
        duration = song_info.get("duration_sec")
        duration_str = f"{int(duration // 60)}:{int(duration % 60):02d}" if duration else "?"
        lines.append(f"- Длительность: {duration_str}")
        lines.append(f"- Формат исходника: {song_info.get('format', '?')}, "
                      f"{song_info.get('sample_rate_hz', '?')} Hz, "
                      f"{song_info.get('channels', '?')} канал(ов)")
    lines.append("")

    lines.append("## Музыка")
    if music:
        lines.append(f"- BPM: **{music.get('bpm', '?')}** "
                      f"(сырое значение до коррекции: {music.get('bpm_raw', '?')})")
        lines.append(f"- Тональность: **{music.get('key', '?')}** "
                      f"(уверенность {music.get('key_confidence', '?')})")
        key_candidates = music.get("key_candidates", [])
        if len(key_candidates) > 1:
            alt = ", ".join(f"{c['key']} ({c['score']})" for c in key_candidates[1:])
            lines.append(f"  - другие варианты: {alt} — если счёт близок к победителю, "
                          f"тональность стоит проверить на слух")
        lines.append(f"- Размер такта: {music.get('time_signature', '?')} "
                      f"(уверенность {music.get('time_signature_confidence', '?')}, "
                      f"{music.get('time_signature_note', '')})")
        key_changes = music.get("key_changes", [])
        if len(key_changes) > 1:
            lines.append(f"- Смен тональности: {len(key_changes) - 1}")
            for kc in key_changes[1:]:
                lines.append(f"  - {kc['time']:.1f}s -> {kc['key']}")
    lines.append("")

    lines.append("## Вокал")
    if reference_notes:
        notes_names = [n["note"] for n in reference_notes]
        durations = [n["duration"] for n in reference_notes]
        lines.append(f"- Всего нот: {len(reference_notes)}")
        lines.append(f"- Средняя длительность ноты: {sum(durations) / len(durations):.2f} сек")
    if breaths:
        n_breaths = sum(1 for p in breaths.get("pauses", []) if p["type"] == "breath")
        n_phrase_ends = sum(1 for p in breaths.get("pauses", []) if p["type"] == "phrase_end")
        lines.append(f"- Фраз (по паузам): {len(breaths.get('phrases', []))}")
        lines.append(f"- Вдохов обнаружено: {n_breaths}, концов фраз: {n_phrase_ends}")
        if "top_db_used" in breaths:
            lines.append(f"- Порог тишины (адаптивный): {breaths['top_db_used']} дБ")
    lines.append("")

    lines.append("## Текст")
    if lyrics_sync:
        lines.append(f"- Строк распознано/синхронизировано: {len(lyrics_sync)}")
    lines.append("")

    if difficulty:
        overall = [s["difficulty"] for s in difficulty if s.get("difficulty")]
        lines.append("## Сложность (по строкам текста)")
        lines.append(f"- Средняя сложность: **{sum(overall) / len(overall):.1f}/10**" if overall else "- Нет данных")
        hardest = max(difficulty, key=lambda s: s.get("difficulty") or 0, default=None)
        if hardest:
            lines.append(f"- Самая сложная строка: \"{hardest.get('text', '?')}\" "
                          f"({hardest['difficulty']}/10, диапазон {hardest.get('range', '?')})")
        lines.append("")

    if difficulty_by_structure:
        lines.append("## Сложность (по структурным блокам)")
        for s in difficulty_by_structure:
            lines.append(f"- {s.get('label', '?')} ({s['start']:.0f}s-{s['end']:.0f}s): "
                          f"сложность {s.get('difficulty', '?')}/10, "
                          f"диапазон {s.get('range', '?')}")
        lines.append("")

    return "\n".join(lines)


def main():
    parser = argparse.ArgumentParser(description="Сборка человекочитаемого отчёта по проекту песни")
    parser.add_argument("project_dir", help="папка проекта, напр. Song/название_песни")
    parser.add_argument("output", nargs="?", default=None,
                         help="куда сохранить (по умолчанию <project_dir>/report.md)")
    args = parser.parse_args()

    output = args.output or str(Path(args.project_dir) / "report.md")
    report_text = build_report(args.project_dir)

    Path(output).write_text(report_text, encoding="utf-8")
    print(f"Отчёт сохранён: {output}")


if __name__ == "__main__":
    main()
