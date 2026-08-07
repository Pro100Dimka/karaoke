"""End-to-end karaoke preparation pipeline.

The public :func:`run` function is used both by the backend and by the batch
CLI.  Heavy analysis stages stay cached on disk; cheap derived artefacts are
rebuilt when the reference melody changes.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Callable, TypeVar

from src.analyze.breath import analyze_breath
from src.analyze.game import extract_game_reference
from src.analyze.music import analyze_music
from src.analyze.structure import segment_structure
from src.analyze.vocal import analyze_vocal
from src.build.convert import convert, normalize_loudness
from src.build.midi import add_tempo_and_key, build_vocal_midi as build_midi, quantize_notes
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
PIPELINE_CACHE_VERSION = 9
ANALYSIS_CACHE_FILES = (
    "pitch.json",
    "reference.json",
    "referenceRaw.json",
    "game_notes.json",
    "breaths.json",
    "lyricsSync.json",
    "songMap.json",
    "difficulty.json",
    "difficultyByStructure.json",
    "melody.mid",
    "manifest.json",
    "report.md",
    "structure.json",
    ".lyrics-sync-state.json",
)



# Единственный профиль для backend/frontend. Параметр preset сохранён только
# для обратной совместимости старых вызовов и больше ничего не переключает.
BALANCED_PROFILE = {
    "demucs_model": "htdemucs",
    "demucs_shifts": "1",
    "demucs_overlap": "0.15",
    "demucs_segment": "7",
    "pitch_engine": "torchcrepe",
    "pitch_model": "full",
    "pitch_step": "0.01",
    "whisper_model": "large-v3-turbo",
    "whisper_beam": "2",
}

def _apply_balanced_profile() -> None:
    # Присваиваем явно: фронтенд всегда получает одинаковый проверенный режим,
    # независимо от оставшихся переменных окружения старых сборок.
    os.environ["SONGAPP_DEMUCS_MODEL"] = BALANCED_PROFILE["demucs_model"]
    os.environ["SONGAPP_DEMUCS_SHIFTS"] = BALANCED_PROFILE["demucs_shifts"]
    os.environ["SONGAPP_DEMUCS_OVERLAP"] = BALANCED_PROFILE["demucs_overlap"]
    os.environ["SONGAPP_DEMUCS_SEGMENT"] = BALANCED_PROFILE["demucs_segment"]
    os.environ["SONGAPP_PITCH_ENGINE"] = BALANCED_PROFILE["pitch_engine"]
    os.environ["SONGAPP_PITCH_MODEL"] = BALANCED_PROFILE["pitch_model"]
    os.environ["SONGAPP_PITCH_STEP"] = BALANCED_PROFILE["pitch_step"]
    os.environ["SONGAPP_FASTER_WHISPER_MODEL"] = BALANCED_PROFILE["whisper_model"]
    os.environ["SONGAPP_WHISPER_BEAM_SIZE"] = BALANCED_PROFILE["whisper_beam"]

class _StageTimer:
    def __init__(self) -> None:
        self.started = time.perf_counter()
        self.rows: list[tuple[str, float]] = []

    def mark(self, name: str) -> None:
        now = time.perf_counter()
        self.rows.append((name, now - self.started))
        self.started = now

    def report(self) -> None:
        print("\nВремя этапов:")
        for name, seconds in self.rows:
            print(f"  {name:<30} {seconds:7.1f} c")


# Files that depend on the final, lyric-aware reference melody.  Structure is
# intentionally excluded: it depends only on the instrumental and is expensive.
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




def _file_sha256(path: str | Path) -> str:
    """Return a fast content fingerprint suitable for cache invalidation.

    Small files are hashed completely. Large audio files are represented by
    their size plus evenly distributed samples, avoiding a full read of several
    hundred megabytes on every frontend request. File modification time is not
    included, so copying an unchanged file does not destroy a valid cache.
    """
    file = Path(path)
    stat = file.stat()
    digest = hashlib.sha256(str(stat.st_size).encode("ascii"))
    sample_size = 256 * 1024
    if stat.st_size <= 8 * 1024 * 1024:
        with file.open("rb") as stream:
            for block in iter(lambda: stream.read(1024 * 1024), b""):
                digest.update(block)
        return digest.hexdigest()

    offsets = (
        0,
        max(0, stat.st_size // 4 - sample_size // 2),
        max(0, stat.st_size // 2 - sample_size // 2),
        max(0, stat.st_size * 3 // 4 - sample_size // 2),
        max(0, stat.st_size - sample_size),
    )
    with file.open("rb") as stream:
        for offset in offsets:
            stream.seek(offset)
            digest.update(stream.read(sample_size))
    return digest.hexdigest()


def _pipeline_state(input_audio: str, whisper_model: str, language: str | None) -> dict[str, Any]:
    return {
        "source_sha256": _file_sha256(input_audio),
        "whisper_model": whisper_model,
        "language": language,
        "demucs_model": os.getenv("SONGAPP_DEMUCS_MODEL", "htdemucs"),
        "demucs_shifts": os.getenv("SONGAPP_DEMUCS_SHIFTS", "1"),
        "demucs_overlap": os.getenv("SONGAPP_DEMUCS_OVERLAP", "0.15"),
        "demucs_segment": os.getenv("SONGAPP_DEMUCS_SEGMENT", "7"),
        "midi_engine": os.getenv("SONGAPP_MIDI_ENGINE", "auto"),
        "faster_whisper_model": os.getenv(
            "SONGAPP_FASTER_WHISPER_MODEL", "large-v3-turbo"
        ),
        "pitch_engine": os.getenv("SONGAPP_PITCH_ENGINE", "torchcrepe"),
        "pitch_model": os.getenv("SONGAPP_PITCH_MODEL", "tiny"),
        "pitch_step": os.getenv("SONGAPP_PITCH_STEP", "0.015"),
        "whisper_beam": os.getenv("SONGAPP_WHISPER_BEAM_SIZE", "2"),
        "whisper_vad": os.getenv("SONGAPP_WHISPER_VAD", "1"),
    }


def _read_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    try:
        value = load_json(path)
    except (OSError, ValueError, TypeError, json.JSONDecodeError):
        return {}
    return value if isinstance(value, dict) else {}


def _delete(paths: PipelinePaths, *names: str) -> None:
    for name in names:
        paths.file(name).unlink(missing_ok=True)


def _invalidate_stems(paths: PipelinePaths) -> None:
    paths.vocals.unlink(missing_ok=True)
    paths.instrumental.unlink(missing_ok=True)
    (paths.separated / ".normalized").unlink(missing_ok=True)
    (paths.separated / ".normalized-state.json").unlink(missing_ok=True)
    for name in ("vocals.wav", "instrumental.wav"):
        (paths.out / "playback" / name).unlink(missing_ok=True)


def _ensure_pipeline_state(
    input_audio: str, paths: PipelinePaths, whisper_model: str, language: str | None
) -> dict[str, Any]:
    """Invalidate only stages affected by changed inputs/settings.

    The state is committed only after a successful run, so a failed frontend
    job cannot mark a half-built project as current.
    """
    current = _pipeline_state(input_audio, whisper_model, language)
    previous = _read_state(paths.file(".pipeline-state.json"))
    if not previous:
        return current

    if previous.get("source_sha256") != current["source_sha256"]:
        print("Исходный аудиофайл изменился; очищаю зависимый кэш.")
        _delete(
            paths,
            "song.wav",
            "songInfo.json",
            "music.json",
            "lyrics.txt",
            ".lyrics-sync-state.json",
            *ANALYSIS_CACHE_FILES,
        )
        _invalidate_stems(paths)
        return current

    demucs_keys = {"demucs_model", "demucs_shifts", "demucs_overlap", "demucs_segment"}
    pitch_keys = {"pitch_engine", "pitch_model", "pitch_step"}
    lyrics_keys = {
        "whisper_model",
        "language",
        "faster_whisper_model",
        "whisper_beam",
        "whisper_vad",
    }

    if any(previous.get(key) != current.get(key) for key in demucs_keys):
        print("Изменились настройки Demucs; пересчитываю дорожки и зависимый анализ.")
        _invalidate_stems(paths)
        _delete(
            paths,
            "music.json",
            "structure.json",
            ".lyrics-sync-state.json",
            *ANALYSIS_CACHE_FILES,
        )
    elif any(previous.get(key) != current.get(key) for key in pitch_keys):
        print("Изменились настройки pitch; пересчитываю ноты и зависимые карты.")
        _delete(
            paths,
            "pitch.json",
            "referenceRaw.json",
            "reference.json",
            "game_notes.json",
            "breaths.json",
            *DERIVED_REFERENCE_FILES,
        )
    elif previous.get("midi_engine") != current.get("midi_engine"):
        print("Изменился движок мелодии; пересчитываю эталон и зависимые карты.")
        _delete(
            paths,
            "referenceRaw.json",
            "reference.json",
            "game_notes.json",
            *DERIVED_REFERENCE_FILES,
        )

    if any(previous.get(key) != current.get(key) for key in lyrics_keys):
        print("Изменились настройки текста; пересинхронизирую слова.")
        _delete(paths, "lyricsSync.json", ".lyrics-sync-state.json", "reference.json", *DERIVED_REFERENCE_FILES)

    return current


def _commit_pipeline_state(paths: PipelinePaths, state: dict[str, Any]) -> None:
    save_json(state, paths.file(".pipeline-state.json"))


def _ensure_cache_version(paths: PipelinePaths) -> None:
    """Invalidate stale analysis once when algorithms or defaults change."""
    marker = paths.file(".ai-cache-version")
    current = marker.read_text(encoding="utf-8").strip() if marker.exists() else ""
    expected = str(PIPELINE_CACHE_VERSION)
    if current == expected:
        return
    if current:
        print(f"Обновлена версия AI-кэша: {current} -> {expected}; пересчитываю анализ.")
    for name in ANALYSIS_CACHE_FILES:
        paths.file(name).unlink(missing_ok=True)
    marker.write_text(expected, encoding="utf-8")


def _use_game_melody_engine() -> bool:
    """Return whether GAME supplies melody events for this installation."""
    if os.getenv("SONGAPP_MIDI_ENGINE", "auto").strip().lower() == "pyin":
        return False
    from src.common.model_paths import game_model_dir

    return (game_model_dir() / "config.json").exists()


def _cached_json(path: Path, label: str, builder: Callable[[], T]) -> T:
    if path.exists():
        try:
            value = load_json(path)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            print(f"{label} — кэш повреждён, пересчитываю")
            path.unlink(missing_ok=True)
        else:
            print(f"{label} — уже есть, пропускаю")
            return value
    print(f"{label}...")
    value = builder()
    save_json(value, path)
    return value


def _ensure_song_info(input_audio: str, paths: PipelinePaths) -> None:
    _cached_json(paths.file("songInfo.json"), "1/13 Проверка файла", lambda: probe_file(input_audio))


def _ensure_song_wav(input_audio: str, paths: PipelinePaths) -> Path:
    song_wav = paths.file("song.wav")
    if song_wav.is_file() and song_wav.stat().st_size > 44:
        print("2/13 Конвертация — уже есть, пропускаю")
    else:
        song_wav.unlink(missing_ok=True)
        print("2/13 Конвертация...")
        convert(input_audio, str(song_wav))
    return song_wav


def _ensure_stems(song_wav: Path, paths: PipelinePaths) -> tuple[Path, Path]:
    stems_ready = all(
        path.is_file() and path.stat().st_size > 44
        for path in (paths.vocals, paths.instrumental)
    )
    if stems_ready:
        print("3/13 Разделение дорожек — уже есть, пропускаю")
        return paths.vocals, paths.instrumental
    paths.vocals.unlink(missing_ok=True)
    paths.instrumental.unlink(missing_ok=True)

    print("3/13 Разделение дорожек (Demucs, может занять время)...")
    stems = separate(str(song_wav), str(paths.separated))
    return Path(stems["vocals"]), Path(stems["instrumental"])


def _normalize_stems(stems: tuple[Path, Path], paths: PipelinePaths) -> None:
    """Optionally build separate playback-normalized stems.

    Analysis always uses untouched Demucs outputs. A content state prevents a
    stale playback file from surviving a later re-separation.
    """
    enabled = os.getenv("SONGAPP_NORMALIZE_STEMS", "0").strip().lower() in {
        "1",
        "true",
        "yes",
    }
    flag = paths.separated / ".normalized"
    state_path = paths.separated / ".normalized-state.json"
    if not enabled:
        flag.unlink(missing_ok=True)
        state_path.unlink(missing_ok=True)
        print("3.5/13 Нормализация анализа отключена (точнее на тихом вокале)")
        return

    playback_dir = paths.out / "playback"
    targets = tuple(playback_dir / source.name for source in stems)
    current_state = {source.name: _file_sha256(source) for source in stems}
    targets_ready = all(target.is_file() and target.stat().st_size > 0 for target in targets)
    if flag.exists() and targets_ready and _read_state(state_path) == current_state:
        print("3.5/13 Нормализация громкости — уже есть, пропускаю")
        return

    print("3.5/13 Нормализация громкости...")
    playback_dir.mkdir(parents=True, exist_ok=True)
    for source, target in zip(stems, targets, strict=True):
        temporary = target.with_name(f".{target.name}.tmp.wav")
        try:
            normalize_loudness(str(source), str(temporary))
            if not temporary.is_file() or temporary.stat().st_size == 0:
                raise RuntimeError(f"Normalization produced an empty file: {temporary}")
            temporary.replace(target)
        finally:
            temporary.unlink(missing_ok=True)
    save_json(current_state, state_path)
    flag.touch()



def _build_pitch(vocals: Path, paths: PipelinePaths) -> list[dict[str, Any]]:
    def analyze() -> list[dict[str, Any]]:
        engine = os.getenv("SONGAPP_PITCH_ENGINE", "torchcrepe").strip().lower()
        model = os.getenv("SONGAPP_PITCH_MODEL", "tiny").strip().lower()
        step = float(os.getenv("SONGAPP_PITCH_STEP", "0.015"))
        print(f"   pitch: {engine}/{model}, шаг {step * 1000:.0f} мс")
        return analyze_vocal(str(vocals), frame_step_sec=step, engine=engine, crepe_model=model)

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
    """Build or load the immutable raw melody before lyric-aware refinement.

    The previous pipeline reused ``reference.json`` as both input and output of
    post-processing. Every repeated run therefore split and trimmed an already
    processed melody again. Keeping a separate raw cache makes the final result
    deterministic and allows safe re-alignment after lyrics are edited.
    """
    raw_path = paths.file("referenceRaw.json")
    if raw_path.exists():
        print("6/13 Сырой эталон мелодии — уже есть, пропускаю")
        return load_json(raw_path)

    print("6/13 Построение сырого эталона мелодии...")
    notes = extract_game_reference(str(vocals), paths.out, language)
    notes = notes if notes is not None else _fallback_reference(pitch_frames)
    save_json(notes, raw_path)
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



def _lyrics_sync_state(
    vocals: Path, lyrics_path: Path, whisper_model: str, language: str | None
) -> dict[str, Any]:
    return {
        "lyrics_sha256": _file_sha256(lyrics_path),
        "vocals_sha256": _file_sha256(vocals),
        "whisper_model": whisper_model,
        "language": language,
        "faster_whisper_model": os.getenv(
            "SONGAPP_FASTER_WHISPER_MODEL", "large-v3-turbo"
        ),
        "whisper_beam": os.getenv("SONGAPP_WHISPER_BEAM_SIZE", "2"),
        "whisper_vad": os.getenv("SONGAPP_WHISPER_VAD", "1"),
    }


def _ensure_lyrics_sync(
    vocals: Path,
    lyrics_path: Path,
    paths: PipelinePaths,
    whisper_model: str,
    language: str | None,
) -> list[dict[str, Any]]:
    """Re-align lyrics whenever their text or transcription inputs change."""
    sync_path = paths.file("lyricsSync.json")
    state_path = paths.file(".lyrics-sync-state.json")
    current = _lyrics_sync_state(vocals, lyrics_path, whisper_model, language)
    previous = _read_state(state_path)

    if sync_path.exists() and previous == current:
        print("9/13 Синхронизация текста — уже есть, пропускаю")
        return load_json(sync_path)

    if sync_path.exists():
        print("9/13 Текст или настройки изменились; пересинхронизирую слова...")
    else:
        print("9/13 Синхронизация текста...")
    value = sync_existing_lyrics_with_whisper(
        str(vocals), str(lyrics_path), whisper_model, language
    )
    save_json(value, sync_path)
    save_json(current, state_path)
    return value

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


def _ensure_midi(music: dict[str, Any], pitch_frames: list[dict[str, Any]], lyrics_sync: list[dict[str, Any]], paths: PipelinePaths) -> Path:
    midi_path = paths.file("melody.mid")
    if midi_path.exists():
        print("12/13 MIDI — уже есть, пропускаю")
        return midi_path

    print("12/13 Экспорт мелодии в MIDI...")
    tempo = float(music.get("bpm", 120.0))
    first_beat = float(music.get("first_beat_sec", 0.0))
    midi = build_midi(
        pitch_frames,
        lyrics_sync,
        instrument_name="Voice Oohs",
        tempo=tempo,
    )
    add_tempo_and_key(midi, str(paths.file("music.json")))
    midi.write(str(midi_path))
    return midi_path


def run(
    input_mp3: str,
    out_dir: str,
    whisper_model: str = "medium",
    language: str | None = None,
    preset: str | None = None,
):
    """Prepare one song and return its generated project manifest."""
    _apply_balanced_profile()
    print("AI профиль: единый оптимизированный balanced")
    timer = _StageTimer()
    paths = PipelinePaths.create(out_dir)
    _ensure_cache_version(paths)
    pipeline_state = _ensure_pipeline_state(input_mp3, paths, whisper_model, language)
    _ensure_song_info(input_mp3, paths)
    song_wav = _ensure_song_wav(input_mp3, paths)
    vocals, instrumental = _ensure_stems(song_wav, paths)
    timer.mark("конвертация + Demucs")
    # CPU-анализ минусовки выполняется одновременно с GPU pitch-анализом.
    # Это не конкурирует за видеопамять и сокращает общее время обработки.
    with ThreadPoolExecutor(max_workers=2) as pool:
        music_future = pool.submit(
            _cached_json, paths.file("music.json"), "4/13 Анализ минусовки",
            lambda: analyze_music(str(instrumental)),
        )
        pitch_future = pool.submit(_build_pitch, vocals, paths)
        music = music_future.result()
        pitch_frames = pitch_future.result()
    timer.mark("музыка + pitch параллельно")
    reference_notes = _build_reference(vocals, pitch_frames, paths, language)
    breaths = _cached_json(
        paths.file("breaths.json"),
        "7/13 Анализ дыхания",
        lambda: analyze_breath(str(vocals), pitch_frames=pitch_frames),
    )
    lyrics_path = _ensure_lyrics(input_mp3, vocals, paths, whisper_model, language)
    lyrics_sync = _ensure_lyrics_sync(
        vocals, lyrics_path, paths, whisper_model, language
    )
    timer.mark("текст + синхронизация")

    print("9.5/13 Дозаполнение пробелов и разбиение долгих нот по слогам...")
    raw_reference = reference_notes
    final_reference_path = paths.file("reference.json")
    previous_final = None
    if final_reference_path.exists():
        try:
            previous_final = load_json(final_reference_path)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            final_reference_path.unlink(missing_ok=True)

    reference_notes = _postprocess_reference(
        raw_reference,
        lyrics_sync,
        pitch_frames,
        using_game=paths.file("game_notes.json").exists(),
    )
    if len(reference_notes) != len(raw_reference):
        print(f"   ноты: {len(raw_reference)} -> {len(reference_notes)}")
    if previous_final != reference_notes:
        save_json(reference_notes, final_reference_path)
        _invalidate_reference_dependents(paths)
    else:
        print("   финальный эталон не изменился; зависимые карты сохраняю")

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
    if structure_path.exists():
        try:
            sections = load_json(structure_path)
        except (OSError, ValueError, TypeError, json.JSONDecodeError):
            structure_path.unlink(missing_ok=True)
            sections = None
    else:
        sections = None
    if sections is None:
        print("11.5/13 Структурная сегментация (куплет/припев)...")
        sections = segment_structure(str(instrumental))
        save_json(sections, structure_path)
    else:
        print("11.5/13 Структура песни — уже есть, пропускаю")

    _cached_json(
        paths.file("difficultyByStructure.json"),
        "11.6/13 Сложность по структуре",
        lambda: build_difficulty_map(reference_notes, sections),
    )

    midi_path = _ensure_midi(music, pitch_frames, lyrics_sync, paths)
    # Нормализация нужна для воспроизведения, но выполняется только после всех
    # анализаторов, чтобы не усиливать утечки инструментов и фоновый шум.
    _normalize_stems((vocals, instrumental), paths)
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
    timer.mark("карты + MIDI + сборка")
    _commit_pipeline_state(paths, pipeline_state)
    timer.report()
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
