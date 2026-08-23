from __future__ import annotations

import shutil
import tempfile
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from .artifacts import publish_files_atomically
from .audio import decode_audio, duration
from .config import CoreConfig
from .engines.registry import EngineRegistry
from .engines.text import UniformTextFallback
from .errors import EngineUnavailableError, ProcessingCancelledError
from .lyrics_document import validate_lyrics_document, words_with_notes
from .lyrics_sources import LyricsDiscovery, discover_lyrics
from .models import StageReport, Word
from .music import analyze_music
from .notes import build_vocal_notes
from .pitch_post import stabilize_pitch
from .processing_modes import resolve_processing_profile
from .runtime import get_runtime_plan
from .utils.io import read_json, write_json_atomic
from .version import AI_BUILD_ID
from .vocal_preprocess import prepare_vocal_reference

ProgressCallback = callable
CancelCallback = callable


@dataclass(frozen=True, slots=True)
class PipelineRequest:
    source_path: str | Path
    output_dir: str | Path
    language: str | None = None
    lyrics_path: str | Path | None = None
    title: str | None = None
    progress: object | None = None
    cancelled: object | None = None
    bpm_override: float | None = None
    key_override: str | None = None
    processing_mode: str = "auto"


@dataclass(frozen=True, slots=True)
class PipelineResult:
    output_dir: Path
    manifest_path: Path
    warnings: tuple[str, ...]
    reports: tuple[StageReport, ...]


class KaraokePipeline:
    VERSION = f"2026.38-{AI_BUILD_ID}"

    def __init__(self, config: CoreConfig | None = None, engines: EngineRegistry | None = None):
        self.config = config or CoreConfig.from_env()
        self.engines = engines or EngineRegistry.create_default(self.config)

    def close(self) -> None:
        getattr(self.engines.separator, "close", lambda: None)()

    @staticmethod
    def _notify(request: PipelineRequest, stage: str, progress: float, detail: str) -> None:
        if callable(request.cancelled) and request.cancelled():
            raise ProcessingCancelledError("Song processing cancelled")
        if callable(request.progress):
            request.progress(stage, progress, detail)

    @staticmethod
    def _stage(reports: list[StageReport], name: str, engine: str, started: float) -> None:
        reports.append(StageReport(name, time.perf_counter() - started, False, engine))

    def _lyrics(
        self,
        request: PipelineRequest,
        vocals: Path,
        discovery: Future[LyricsDiscovery | None] | None = None,
    ) -> tuple[str, list[Word]]:
        if request.lyrics_path and Path(request.lyrics_path).is_file():
            text = Path(request.lyrics_path).read_text(encoding="utf-8").strip()
            return text, []
        found = discovery.result() if discovery else discover_lyrics(request.title)
        if found:
            print(f"[lyrics] FOUND via {found.source}", flush=True)
            return found.text, []
        print("[lyrics] NOT FOUND online -> ASR fallback", flush=True)
        text, words = self.engines.transcriber.transcribe(vocals, request.language)
        return text, words

    def _align(self, vocals: Path, text: str, language: str | None, direct: list[Word]) -> list[Word]:
        if direct:
            return [Word(word.start, word.end, word.text, word.confidence, index) for index, word in enumerate(direct)]
        try:
            words = self.engines.aligner.align_long_text(vocals, text, language)
        except Exception:
            if not self.config.allow_fallback:
                raise
            words = UniformTextFallback().align(vocals, text, language)
        return [Word(word.start, word.end, word.text, word.confidence, index) for index, word in enumerate(words)]

    def run(self, request: PipelineRequest) -> PipelineResult:
        source, output = Path(request.source_path).resolve(), Path(request.output_dir).resolve()
        if not source.is_file():
            raise FileNotFoundError(source)
        output.mkdir(parents=True, exist_ok=True)
        reports: list[StageReport] = []
        warnings: list[str] = []
        profile = resolve_processing_profile(request.processing_mode, get_runtime_plan())

        with (
            tempfile.TemporaryDirectory(prefix=".ai-clean-", dir=output) as temporary,
            ThreadPoolExecutor(max_workers=2, thread_name_prefix="ai-independent") as parallel,
        ):
            work = Path(temporary)
            mix, raw_vocals = work / "mix.wav", work / "vocals.raw.flac"
            vocals, instrumental, lyrics = work / "vocals.flac", work / "instrumental.flac", work / "lyricsSync.json"
            discovery = (
                parallel.submit(discover_lyrics, request.title)
                if request.title and not request.lyrics_path else None
            )

            self._notify(request, "decode", 3, "Декодирование исходной записи")
            started = time.perf_counter()
            decode_audio(source, mix, self.config.sample_rate, 2)
            self._stage(reports, "decode", "ffmpeg", started)

            self._notify(request, "separate", 10, "Разделение голоса и минуса")
            started = time.perf_counter()
            self.engines.separator.separate(
                mix, raw_vocals, instrumental,
                profile=profile, cancelled=request.cancelled,
            )
            self._stage(reports, "separate", self.engines.separator.name, started)

            music_started = time.perf_counter()
            music_future = parallel.submit(analyze_music, instrumental)

            self._notify(request, "vocal", 42, "Очистка и перевод голоса в моно")
            started = time.perf_counter()
            prepare_vocal_reference(raw_vocals, vocals, self.config.sample_rate)
            self._stage(reports, "vocal", "ffmpeg-mono-clean", started)

            self._notify(request, "analysis", 48, "Анализ музыки и мелодии по vocals.flac")
            pitch_started = time.perf_counter()
            pitch = stabilize_pitch(self.engines.pitch.estimate(vocals))
            self._stage(reports, "pitch", self.engines.pitch.name, pitch_started)
            music = music_future.result()
            self._stage(reports, "music", "librosa", music_started)

            self._notify(request, "lyrics", 70, "Поиск и синхронизация текста")
            started = time.perf_counter()
            text, direct = self._lyrics(request, vocals, discovery)
            if not text:
                raise EngineUnavailableError("Lyrics and ASR transcript are unavailable")
            words = self._align(vocals, text, request.language, direct)
            self._stage(reports, "lyrics", self.engines.aligner.name, started)

            self._notify(request, "notes", 84, "Построение мелодии голоса")
            started = time.perf_counter()
            notes = build_vocal_notes(
                pitch, words=words, min_note=self.config.min_note_sec,
                split_semitones=self.config.split_note_semitones,
                max_gap=self.config.max_gap_sec, min_confidence=self.config.min_voiced_confidence,
            )
            self._stage(reports, "notes", "fcpe-segments", started)

            payload = validate_lyrics_document({
                "bpm": request.bpm_override or music["bpm"],
                "duration": round(duration(vocals), 3),
                "key": request.key_override or music["key"],
                "reference_audio": "vocals.flac",
                "text": text,
                "words": words_with_notes(words, notes),
            })
            write_json_atomic(lyrics, payload, compact=True)
            self._notify(request, "validate", 98, "Проверка результата")
            publish_files_atomically([
                (vocals, output / "vocals.flac"),
                (instrumental, output / "instrumental.flac"),
                (lyrics, output / "lyricsSync.json"),
            ])

        for stale in output.iterdir():
            if stale.name not in {"vocals.flac", "instrumental.flac", "lyricsSync.json", "cover.jpg", "cover.png"} and stale.is_dir() and stale.name in {"logs", "separated", ".ai-cache"}:
                shutil.rmtree(stale, ignore_errors=True)
        self._notify(request, "complete", 100, "Готово")
        return PipelineResult(output, output / "lyricsSync.json", tuple(warnings), tuple(reports))

    def reprocess(self, output_dir: str | Path, **options) -> PipelineResult:
        output = Path(output_dir).resolve()
        vocals, lyrics = output / "vocals.flac", output / "lyricsSync.json"
        if not vocals.is_file() or not lyrics.is_file():
            raise FileNotFoundError("vocals.flac and lyricsSync.json are required")
        current = validate_lyrics_document(read_json(lyrics))
        text = str(current.get("text") or "").strip()
        if not text:
            raise EngineUnavailableError("lyricsSync.json has no text to align")
        request = PipelineRequest(vocals, output, **options)
        reports: list[StageReport] = []

        self._notify(request, "analysis", 48, "Анализ мелодии по vocals.flac")
        started = time.perf_counter()
        pitch = stabilize_pitch(self.engines.pitch.estimate(vocals))
        self._stage(reports, "pitch", self.engines.pitch.name, started)

        self._notify(request, "lyrics", 70, "Синхронизация текста по vocals.flac")
        started = time.perf_counter()
        words = self._align(vocals, text, request.language, [])
        self._stage(reports, "lyrics", self.engines.aligner.name, started)

        self._notify(request, "notes", 84, "Построение мелодии голоса")
        started = time.perf_counter()
        notes = build_vocal_notes(
            pitch, words=words, min_note=self.config.min_note_sec,
            split_semitones=self.config.split_note_semitones,
            max_gap=self.config.max_gap_sec,
            min_confidence=self.config.min_voiced_confidence,
        )
        self._stage(reports, "notes", "fcpe-segments", started)
        payload = validate_lyrics_document({
            **current,
            "duration": round(duration(vocals), 3),
            "reference_audio": "vocals.flac",
            "text": text,
            "words": words_with_notes(words, notes),
        })
        write_json_atomic(lyrics, payload, compact=True)
        self._notify(request, "complete", 100, "Готово")
        return PipelineResult(output, lyrics, (), tuple(reports))
