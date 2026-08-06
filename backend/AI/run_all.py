"""End-to-end karaoke preparation pipeline.

The public :func:`run` function is used both by the backend and by the batch
CLI.  Heavy analysis stages stay cached on disk; cheap derived artefacts are
rebuilt when the reference melody changes.
"""

from __future__ import annotations

import argparse
import os
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TypeVar

from src.analyze.breath import analyze_breath
from src.analyze.game import extract_game_reference
from src.analyze.music import analyze_music
from src.analyze.structure import segment_structure
from src.analyze.vocal import analyze_vocal
from src.build.convert import convert, normalize_loudness
from src.build.midi import add_tempo_and_key, build_midi, quantize_notes
from src.build.project import build_project
from src.build.reference import (
    build_reference,
    correct_confirmed_neural_octaves,
    refine_neural_reference,
)
from src.build.report import build_report
from src.build.split_notes import (
    align_note_boundaries_to_words,
    filter_unanchored_long_notes,
    fill_gaps_during_active_singing,
    split_notes_by_syllables,
    trim_quiet_unanchored_note_tails,
)
from src.build.unified_song_map import build_song_map
from src.common.json_io import load_json, save_json
from src.evaluation.difficulty_map import build_difficulty_map
from src.lyrics.get_text import get_lyrics
from src.lyrics.sync import sync_existing_lyrics_with_whisper
from src.preprocessing.probe import probe_file
from src.preprocessing.separate import separate

T = TypeVar("T")
AUDIO_PATTERNS = ("*.mp3", "*.wav", "*.flac", "*.m4a", "*.ogg")
DERIVED_REFERENCE_FILES = (
    "songMap.json",
    "difficulty.json",
    "difficultyByStructure.json",
    "melody.mid",
    "manifest.json",
    "report.md",
)


@dataclass(frozen=True)
class PipelinePaths:
    """All stable filesystem locations used by one pipeline run."""

    out: Path

    @classmethod
    def create(cls, out_dir: str | Path) -> "PipelinePaths":
        out = Path(out_dir)
        out.mkdir(parents=True, exist_ok=True)
        return cls(out=out)

    def file(self, name: str) -> Path:
        return self.out / name

    @property
    def separated(self) -> Path:
        return self.out / "separated"

    @property
    def vocals(self) -> Path:
        return self.separated / "vocals.wav"

    @property
    def instrumental(self) -> Path:
        return self.separated / "instrumental.wav"


def _use_game_melody_engine() -> bool:
    """Return whether GAME supplies melody events for this installation."""
    if os.getenv("SONGAPP_MIDI_ENGINE", "auto").strip().lower() == "pyin":
        return False
    from src.common.model_paths import game_model_dir

    return (game_model_dir() / "config.json").exists()


def _cached_json(path: Path, label: str, builder: Callable[[], T]) -> T:
    if path.exists():
        print(f"{label} — уже есть, пропускаю")
        return load_json(path)
    print(f"{label}...")
    value = builder()
    save_json(value, path)
    return value


def _ensure_song_info(input_audio: str, paths: PipelinePaths) -> None:
    _cached_json(paths.file("songInfo.json"), "1/13 Проверка файла", lambda: probe_file(input_audio))


def _ensure_song_wav(input_audio: str, paths: PipelinePaths) -> Path:
    song_wav = paths.file("song.wav")
    if song_wav.exists():
        print("2/13 Конвертация — уже есть, пропускаю")
    else:
        print("2/13 Конвертация...")
        convert(input_audio, str(song_wav))
    return song_wav


def _ensure_stems(song_wav: Path, paths: PipelinePaths) -> tuple[Path, Path]:
    if paths.vocals.exists() and paths.instrumental.exists():
        print("3/13 Разделение дорожек — уже есть, пропускаю")
        return paths.vocals, paths.instrumental

    print("3/13 Разделение дорожек (Demucs, может занять время)...")
    stems = separate(str(song_wav), str(paths.separated))
    return Path(stems["vocals"]), Path(stems["instrumental"])


def _normalize_stems(stems: tuple[Path, Path], paths: PipelinePaths) -> None:
    flag = paths.separated / ".normalized"
    if flag.exists():
        print("3.5/13 Нормализация громкости — уже есть, пропускаю")
        return

    print("3.5/13 Нормализация громкости...")
    for source in stems:
        temporary = source.with_name(f"{source.name}.tmp.wav")
        try:
            normalize_loudness(str(source), str(temporary))
            temporary.replace(source)
        finally:
            temporary.unlink(missing_ok=True)
    flag.touch()


def _build_pitch(vocals: Path, paths: PipelinePaths) -> list[dict[str, Any]]:
    def analyze() -> list[dict[str, Any]]:
        engine = "torchcrepe" if _use_game_melody_engine() else "pyin"
        if engine == "torchcrepe":
            print("   GAME supplies note events; TorchCrepe verifies vocal pitch.")
        return analyze_vocal(str(vocals), engine=engine)

    return _cached_json(paths.file("pitch.json"), "5/13 Анализ вокала (pitch)", analyze)


def _fallback_reference(pitch_frames: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return build_reference(
        pitch_frames,
        min_note_duration=0.12,
        confidence_percentile=18.0,
        min_confidence_floor=0.03,
        max_confidence_ceiling=0.42,
        smoothing_window=9,
        stable_frames=7,
        max_gap_sec=0.12,
    )


def _build_reference(
    vocals: Path,
    pitch_frames: list[dict[str, Any]],
    paths: PipelinePaths,
    language: str | None,
) -> list[dict[str, Any]]:
    reference_path = paths.file("reference.json")
    game_cache = paths.file("game_notes.json").exists()
    if game_cache:
        print("6/13 Нормализация эталонной мелодии GAME...")
        notes = extract_game_reference(str(vocals), paths.out, language)
        if notes is None:
            raise RuntimeError("Cached GAME melody could not be normalized")
        save_json(notes, reference_path)
        return notes
    if reference_path.exists():
        print("6/13 Эталонная мелодия — уже есть, пропускаю")
        return load_json(reference_path)

    print("6/13 Построение эталонной мелодии...")
    notes = extract_game_reference(str(vocals), paths.out, language)
    notes = notes if notes is not None else _fallback_reference(pitch_frames)
    save_json(notes, reference_path)
    return notes


def _ensure_lyrics(
    input_audio: str,
    vocals: Path,
    paths: PipelinePaths,
    whisper_model: str,
    language: str | None,
) -> Path:
    lyrics_path = paths.file("lyrics.txt")
    if lyrics_path.exists():
        print("8/13 Получение текста — уже есть, пропускаю")
        return lyrics_path

    print("8/13 Получение текста...")
    text, source = get_lyrics(
        input_audio,
        whisper_model,
        language,
        whisper_audio_path=str(vocals),
        transcribe_if_missing=False,
    )
    lyrics_path.write_text(text, encoding="utf-8")
    print(f"   источник текста: {source}")
    return lyrics_path


def _postprocess_reference(
    notes: list[dict[str, Any]],
    lyrics_sync: list[dict[str, Any]],
    pitch_frames: list[dict[str, Any]],
    using_game: bool,
) -> list[dict[str, Any]]:
    if using_game:
        notes = refine_neural_reference(notes, pitch_frames)
        notes = correct_confirmed_neural_octaves(notes, pitch_frames)
    else:
        notes = fill_gaps_during_active_singing(notes, lyrics_sync, pitch_frames)

    notes = split_notes_by_syllables(
        notes,
        lyrics_sync,
        pitch_frames,
        acoustic_search_window=0.20,
        acoustic_dip_margin_db=1.5,
        include_syllables=not using_game,
    )
    notes = align_note_boundaries_to_words(notes, lyrics_sync, pitch_frames)
    notes = trim_quiet_unanchored_note_tails(notes, lyrics_sync, pitch_frames)
    return filter_unanchored_long_notes(notes, lyrics_sync)


def _invalidate_reference_dependents(paths: PipelinePaths) -> None:
    for name in DERIVED_REFERENCE_FILES:
        paths.file(name).unlink(missing_ok=True)


def _ensure_midi(music: dict[str, Any], notes: list[dict[str, Any]], paths: PipelinePaths) -> Path:
    midi_path = paths.file("melody.mid")
    if midi_path.exists():
        print("12/13 MIDI — уже есть, пропускаю")
        return midi_path

    print("12/13 Экспорт мелодии в MIDI...")
    tempo = float(music.get("bpm", 120.0))
    first_beat = float(music.get("first_beat_sec", 0.0))
    midi_notes = quantize_notes(notes, tempo, first_beat, division=16, strength=0.5)
    midi = build_midi(midi_notes, instrument_name="Voice Oohs", tempo=tempo)
    add_tempo_and_key(midi, str(paths.file("music.json")))
    midi.write(str(midi_path))
    return midi_path


def run(
    input_mp3: str,
    out_dir: str,
    whisper_model: str = "medium",
    language: str | None = None,
):
    """Prepare one song and return its generated project manifest."""
    paths = PipelinePaths.create(out_dir)
    _ensure_song_info(input_mp3, paths)
    song_wav = _ensure_song_wav(input_mp3, paths)
    vocals, instrumental = _ensure_stems(song_wav, paths)
    _normalize_stems((vocals, instrumental), paths)

    music = _cached_json(
        paths.file("music.json"),
        "4/13 Анализ минусовки",
        lambda: analyze_music(str(instrumental)),
    )
    pitch_frames = _build_pitch(vocals, paths)
    reference_notes = _build_reference(vocals, pitch_frames, paths, language)
    breaths = _cached_json(
        paths.file("breaths.json"),
        "7/13 Анализ дыхания",
        lambda: analyze_breath(str(vocals), pitch_frames=pitch_frames),
    )
    lyrics_path = _ensure_lyrics(input_mp3, vocals, paths, whisper_model, language)
    lyrics_sync = _cached_json(
        paths.file("lyricsSync.json"),
        "9/13 Синхронизация текста",
        lambda: sync_existing_lyrics_with_whisper(
            str(vocals), str(lyrics_path), whisper_model, language
        ),
    )

    print("9.5/13 Дозаполнение пробелов и разбиение долгих нот по слогам...")
    original_reference = reference_notes
    reference_notes = _postprocess_reference(
        reference_notes,
        lyrics_sync,
        pitch_frames,
        using_game=paths.file("game_notes.json").exists(),
    )
    if len(reference_notes) != len(original_reference):
        print(f"   ноты: {len(original_reference)} -> {len(reference_notes)}")
    save_json(reference_notes, paths.file("reference.json"))
    if reference_notes != original_reference:
        _invalidate_reference_dependents(paths)

    _cached_json(
        paths.file("songMap.json"),
        "10/13 Построение карты песни",
        lambda: build_song_map(music, reference_notes, lyrics_sync, breaths, pitch_frames),
    )
    _cached_json(
        paths.file("difficulty.json"),
        "11/13 Карта сложности",
        lambda: build_difficulty_map(reference_notes, lyrics_sync),
    )

    structure_path = paths.file("structure.json")
    difficulty_by_structure_path = paths.file("difficultyByStructure.json")
    if structure_path.exists() and difficulty_by_structure_path.exists():
        print("11.5/13 Структура песни — уже есть, пропускаю")
    else:
        print("11.5/13 Структурная сегментация (куплет/припев)...")
        sections = segment_structure(str(instrumental))
        save_json(sections, structure_path)
        save_json(build_difficulty_map(reference_notes, sections), difficulty_by_structure_path)

    midi_path = _ensure_midi(music, reference_notes, paths)
    print("13/13 Сборка проекта...")
    manifest = build_project(
        str(paths.out),
        song_info=str(paths.file("songInfo.json")),
        instrumental=str(instrumental),
        vocals=str(vocals),
        pitch=str(paths.file("pitch.json")),
        reference=str(paths.file("reference.json")),
        lyrics_sync=str(paths.file("lyricsSync.json")),
        music=str(paths.file("music.json")),
        breaths=str(paths.file("breaths.json")),
        difficulty=str(paths.file("difficulty.json")),
        song_map=str(paths.file("songMap.json")),
        midi=str(midi_path),
    )

    print("13.5/13 Формирование отчёта...")
    paths.file("report.md").write_text(build_report(str(paths.out)), encoding="utf-8")
    print("Готово! Проект собран в:", paths.out)
    return manifest


def _find_audio_files(input_dir: Path) -> list[Path]:
    return sorted(file for pattern in AUDIO_PATTERNS for file in input_dir.glob(pattern))


def main() -> None:
    parser = argparse.ArgumentParser(description="Полный пайплайн подготовки караоке")
    parser.add_argument("--input-dir", default="full_songs", help="Папка с песнями")
    parser.add_argument("--out", default="Song", help="Папка для готовых проектов")
    parser.add_argument("--whisper-model", default="medium")
    parser.add_argument("--language", default=None)
    args = parser.parse_args()

    input_dir = Path(args.input_dir)
    if not input_dir.exists():
        print(f"Папка не найдена: {input_dir}")
        return

    songs = _find_audio_files(input_dir)
    if not songs:
        print(f"В папке '{input_dir}' не найдено аудиофайлов ({', '.join(AUDIO_PATTERNS)}).")
        return

    print(f"Найдено песен: {len(songs)}")
    for index, song in enumerate(songs, start=1):
        print("\n" + "=" * 80)
        print(f"[{index}/{len(songs)}] {song.stem}")
        print("=" * 80)
        try:
            run(str(song), str(Path(args.out) / song.stem), args.whisper_model, args.language)
        except Exception as error:  # CLI must continue with the remaining files.
            print(f"\nОшибка при обработке '{song.stem}':")
            print(error)
    print("\nВсе песни обработаны.")


if __name__ == "__main__":
    main()
