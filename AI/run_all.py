"""
Полный пайплайн: song.mp3 -> готовый проект в Song/

Структура проекта:
    AI/
    └── src/
        ├── analyze/       (music.py, vocal.py, breath.py)
        ├── build/         (convert.py, reference.py, unified_song_map.py,
        │                   project.py, midi.py)
        ├── evaluation/    (difficulty_map.py)
        ├── lyrics/        (get_text.py, sync.py)
        └── preprocessing/ (probe.py, separate.py)
    ├── run_all.py
    ├── requirements.txt
    └── song.mp3

Запуск:
    python run_all.py song.mp3 --out Song

Требует: ffmpeg в PATH и pip install -r requirements.txt
"""
import argparse
import json
from pathlib import Path

from src.analyze.breath import analyze_breath
from src.analyze.music import analyze_music
from src.analyze.structure import segment_structure
from src.analyze.vocal import analyze_vocal
from src.build.convert import convert, normalize_loudness
from src.build.midi import add_tempo_and_key, build_midi, quantize_notes
from src.build.project import build_project
from src.build.reference import build_reference
from src.build.report import build_report
from src.build.split_notes import split_notes_by_syllables
from src.build.unified_song_map import build_song_map
from src.evaluation.difficulty_map import build_difficulty_map
from src.lyrics.get_text import get_lyrics
from src.lyrics.sync import sync_existing_lyrics_with_whisper
from src.preprocessing.probe import probe_file
from src.preprocessing.separate import separate


def save_json(obj, path):
    with open(path, "w", encoding="utf-8") as f:
        json.dump(obj, f, ensure_ascii=False, indent=2)


def load_json(path):
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)


def run(input_mp3: str, out_dir: str, whisper_model: str = "medium",
        language: str | None = None):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    # --- 1/13 Проверка файла ---
    song_info_path = out / "songInfo.json"
    if song_info_path.exists():
        print("1/13 Проверка файла — уже есть, пропускаю")
    else:
        print("1/13 Проверка файла...")
        song_info = probe_file(input_mp3)
        save_json(song_info, song_info_path)

    # --- 2/13 Конвертация ---
    song_wav = out / "song.wav"
    if song_wav.exists():
        print("2/13 Конвертация — уже есть, пропускаю")
    else:
        print("2/13 Конвертация...")
        convert(input_mp3, str(song_wav))

    # --- 3/13 Разделение дорожек ---
    vocals_path = out / "separated" / "vocals.wav"
    instrumental_path = out / "separated" / "instrumental.wav"
    if vocals_path.exists() and instrumental_path.exists():
        print("3/13 Разделение дорожек — уже есть, пропускаю")
    else:
        print("3/13 Разделение дорожек (Demucs, может занять время)...")
        stems = separate(str(song_wav), str(out / "separated"))
        vocals_path = Path(stems["vocals"])
        instrumental_path = Path(stems["instrumental"])
    vocals_path, instrumental_path = str(vocals_path), str(instrumental_path)

    # --- 3.5/13 Нормализация громкости ---
    # Пороги в analyze_breath (top_db) и confidence в pitch-детекторах
    # калибровались на "типичной" громкости. Нормализация приводит все
    # песни к одному уровню (-16 LUFS) перед анализом, чтобы пороги
    # срабатывали одинаково независимо от того, как трек был сведён.
    normalized_flag = out / "separated" / ".normalized"
    if normalized_flag.exists():
        print("3.5/13 Нормализация громкости — уже есть, пропускаю")
    else:
        print("3.5/13 Нормализация громкости...")
        for p in (vocals_path, instrumental_path):
            tmp_path = p + ".tmp.wav"
            normalize_loudness(p, tmp_path)
            Path(tmp_path).replace(p)
        normalized_flag.touch()

    # --- 4/13 Анализ минусовки ---
    music_path = out / "music.json"
    if music_path.exists():
        print("4/13 Анализ минусовки — уже есть, пропускаю")
        music = load_json(music_path)
    else:
        print("4/13 Анализ минусовки...")
        music = analyze_music(instrumental_path)
        save_json(music, music_path)

    # --- 5/13 Анализ вокала (pitch) ---
    pitch_path = out / "pitch.json"
    if pitch_path.exists():
        print("5/13 Анализ вокала — уже есть, пропускаю")
        pitch_frames = load_json(pitch_path)
    else:
        print("5/13 Анализ вокала (pitch)...")
        pitch_frames = analyze_vocal(vocals_path)
        save_json(pitch_frames, pitch_path)

    # --- 6/13 Эталонная мелодия ---
    reference_path = out / "reference.json"
    if reference_path.exists():
        print("6/13 Эталонная мелодия — уже есть, пропускаю")
        reference_notes = load_json(reference_path)
    else:
        print("6/13 Построение эталонной мелодии...")
        reference_notes = build_reference(pitch_frames)
        save_json(reference_notes, reference_path)

    # --- 7/13 Анализ дыхания ---
    breaths_path = out / "breaths.json"
    if breaths_path.exists():
        print("7/13 Анализ дыхания — уже есть, пропускаю")
        breaths = load_json(breaths_path)
    else:
        print("7/13 Анализ дыхания...")
        breaths = analyze_breath(vocals_path, pitch_frames=pitch_frames)
        save_json(breaths, breaths_path)

    # --- 8/13 Текст ---
    lyrics_path = out / "lyrics.txt"
    if lyrics_path.exists():
        print("8/13 Получение текста — уже есть, пропускаю")
    else:
        print("8/13 Получение текста...")
        lyrics_text, source = get_lyrics(input_mp3, whisper_model, language,
                                          whisper_audio_path=vocals_path)
        lyrics_path.write_text(lyrics_text, encoding="utf-8")
        print(f"   источник текста: {source}")

    # --- 9/13 Синхронизация текста ---
    lyrics_sync_path = out / "lyricsSync.json"
    if lyrics_sync_path.exists():
        print("9/13 Синхронизация текста — уже есть, пропускаю")
        lyrics_sync = load_json(lyrics_sync_path)
    else:
        print("9/13 Синхронизация текста...")
        lyrics_sync = sync_existing_lyrics_with_whisper(
            vocals_path, str(lyrics_path), whisper_model, language)
        save_json(lyrics_sync, lyrics_sync_path)

    # --- 9.5/13 Разбиение долгих нот по слогам текста ---
    # ИСПРАВЛЕНО: если певец держит одну ноту на протяжении целой фразы/
    # слова из нескольких слогов, build_reference (шаг 6) строит из этого
    # одну длинную ноту — сам pitch не знает про текст. Здесь используем
    # word-level тайминги lyricsSync.json, чтобы разбить такие ноты на
    # несколько того же тона, по одной на слог (см. src/build/split_notes.py
    # и src/lyrics/syllabify.py). Выполняется каждый раз (не кэшируется по
    # наличию файла), чтобы проекты, собранные до появления этого шага,
    # тоже получили разбиение при повторном запуске; сам шаг идемпотентен.
    print("9.5/13 Разбиение долгих нот по слогам...")
    notes_before = len(reference_notes)
    reference_notes = split_notes_by_syllables(reference_notes, lyrics_sync)
    if len(reference_notes) != notes_before:
        print(f"   ноты: {notes_before} -> {len(reference_notes)}")
        save_json(reference_notes, reference_path)

    # --- 10/13 Карта песни ---
    song_map_path = out / "songMap.json"
    if song_map_path.exists():
        print("10/13 Карта песни — уже есть, пропускаю")
    else:
        print("10/13 Построение карты песни...")
        song_map = build_song_map(
            music, reference_notes, lyrics_sync, breaths, pitch_frames)
        save_json(song_map, song_map_path)

    # --- 11/13 Карта сложности (по строкам текста) ---
    difficulty_path = out / "difficulty.json"
    if difficulty_path.exists():
        print("11/13 Карта сложности — уже есть, пропускаю")
    else:
        print("11/13 Карта сложности...")
        difficulty = build_difficulty_map(reference_notes, lyrics_sync)
        save_json(difficulty, difficulty_path)

    # --- 11.5/13 Структурная сегментация + карта сложности по блокам ---
    structure_path = out / "structure.json"
    difficulty_by_structure_path = out / "difficultyByStructure.json"
    if structure_path.exists() and difficulty_by_structure_path.exists():
        print("11.5/13 Структура песни — уже есть, пропускаю")
    else:
        print("11.5/13 Структурная сегментация (куплет/припев)...")
        structure_sections = segment_structure(instrumental_path)
        save_json(structure_sections, structure_path)
        difficulty_by_structure = build_difficulty_map(reference_notes, structure_sections)
        save_json(difficulty_by_structure, difficulty_by_structure_path)

    # --- 12/13 MIDI ---
    midi_path = out / "melody.mid"
    if midi_path.exists():
        print("12/13 MIDI — уже есть, пропускаю")
    else:
        print("12/13 Экспорт мелодии в MIDI...")
        tempo = (
            music.get("tempo")
            or music.get("bpm")
            or music.get("Tempo")
            or 120.0
        )
        first_beat = float(music.get("first_beat_sec", 0.0))

        midi_notes = quantize_notes(reference_notes, tempo, first_beat,
                                     division=16, strength=0.5)

        midi = build_midi(
            midi_notes,
            instrument_name="Voice Oohs",
            tempo=tempo,
        )

        add_tempo_and_key(midi, str(music_path))

        midi.write(str(midi_path))

    # --- 13/13 Сборка проекта (манифест) ---
    manifest_path = out / "manifest.json"
    print("13/13 Сборка проекта...")
    manifest = build_project(
        str(out),
        song_info=str(song_info_path),
        instrumental=instrumental_path,
        vocals=vocals_path,
        pitch=str(pitch_path),
        reference=str(reference_path),
        lyrics_sync=str(lyrics_sync_path),
        music=str(music_path),
        breaths=str(breaths_path),
        difficulty=str(difficulty_path),
        song_map=str(song_map_path),
        midi=str(midi_path),
    )

    print("13.5/13 Формирование отчёта...")
    report_text = build_report(str(out))
    (out / "report.md").write_text(report_text, encoding="utf-8")

    print("Готово! Проект собран в:", out)
    return manifest


def main():
    parser = argparse.ArgumentParser(
        description="Полный пайплайн подготовки караоке")
    parser.add_argument(
        "--input-dir",
        default="full_songs",
        help="Папка с песнями (mp3/wav/flac/m4a)"
    )
    parser.add_argument(
        "--out",
        default="Song",
        help="Папка, куда будут складываться проекты"
    )
    parser.add_argument("--whisper-model", default="medium")
    parser.add_argument("--language", default=None)

    args = parser.parse_args()

    input_dir = Path(args.input_dir)

    if not input_dir.exists():
        print(f"Папка не найдена: {input_dir}")
        return

    audio_extensions = ("*.mp3", "*.wav", "*.flac", "*.m4a", "*.ogg")
    song_files = sorted(
        f for ext in audio_extensions for f in input_dir.glob(ext)
    )

    if not song_files:
        print(f"В папке '{input_dir}' не найдено аудиофайлов "
              f"({', '.join(audio_extensions)}).")
        return

    print(f"Найдено песен: {len(song_files)}")

    for index, song_file in enumerate(song_files, start=1):
        song_name = song_file.stem
        out_dir = Path(args.out) / song_name

        print("\n" + "=" * 80)
        print(f"[{index}/{len(song_files)}] {song_name}")
        print("=" * 80)

        try:
            run(
                str(song_file),
                str(out_dir),
                args.whisper_model,
                args.language
            )
        except Exception as e:
            print(f"\nОшибка при обработке '{song_name}':")
            print(e)

    print("\nВсе песни обработаны.")


if __name__ == "__main__":
    main()
