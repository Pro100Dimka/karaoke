from __future__ import annotations

import shutil
import tempfile
import time
from concurrent.futures import Future, ThreadPoolExecutor
from dataclasses import dataclass
from pathlib import Path

from .artifacts import publish_files_atomically
from .audio import audio_buffer_cache, decode_audio, duration
from .config import CoreConfig
from .engines.device import release_torch_memory
from .engines.registry import EngineRegistry
from .engines.text import UniformTextFallback, tokenize
from .errors import EngineUnavailableError, ProcessingCancelledError
from .lyrics_document import validate_lyrics_document, words_with_notes
from .lyrics_sources import LyricsDiscovery, TimedLine, discover_lyrics
from .models import StageReport, Word
from .music import analyze_music
from .notes import build_vocal_notes
from .pitch_post import stabilize_pitch
from .processing_modes import resolve_processing_profile
from .runtime import get_runtime_plan
from .utils.io import read_json, write_json_atomic
from .version import AI_BUILD_ID
from .vocal_preprocess import prepare_vocal_reference
from .word_voicing import anchor_words_to_voice, voice_activity_intervals

ProgressCallback = callable
CancelCallback = callable


def _process_rss_bytes() -> int:
    try:
        import psutil
        return psutil.Process().memory_info().rss
    except Exception:  # best-effort telemetry -- must never fail a stage
        return 0


def _cuda_memory_bytes() -> tuple[int, int]:
    try:
        import torch
        if torch.cuda.is_available():
            return torch.cuda.memory_allocated(), torch.cuda.memory_reserved()
    except Exception:  # best-effort telemetry -- must never fail a stage
        pass
    return 0, 0


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
        self._release_engines(
            self.engines.separator,
            self.engines.pitch,
            self.engines.transcriber,
            self.engines.aligner,
        )

    def separate_stems(
        self,
        source_path: str | Path,
        vocals_path: str | Path,
        instrumental_path: str | Path,
        *,
        processing_mode: str = "fast",
    ) -> None:
        """Split one reference track without running the karaoke pipeline.

        Training imports only need the two raw stems.  In particular, do not
        run vocal cleanup, transcription, pitch extraction or alignment here.
        Keeping the separator worker alive also avoids loading the model again
        for every item in a large KAR/MID/KFN batch.
        """
        profile = resolve_processing_profile(processing_mode, get_runtime_plan())
        self.engines.separator.separate(
            Path(source_path),
            Path(vocals_path),
            Path(instrumental_path),
            profile=profile,
        )

    @staticmethod
    def _release_engines(*engines: object) -> None:
        for engine in engines:
            getattr(engine, "close", lambda: None)()
        release_torch_memory()

    @staticmethod
    def _park_engines(*engines: object) -> None:
        # Keeping several neural networks resident in system RAM is useful on
        # workstations, but on 16 GB machines it pushes Windows into paging and
        # can make the mouse and unrelated applications stutter.  Prefer a
        # clean unload unless the machine has comfortable total *and* currently
        # available memory headroom.
        keep_warm = False
        try:
            import psutil

            memory = psutil.virtual_memory()
            keep_warm = memory.total >= 32 * 1024**3 and memory.available >= 10 * 1024**3
        except Exception:
            pass
        for engine in engines:
            action = getattr(engine, "park", None) if keep_warm else None
            (action or getattr(engine, "close", lambda: None))()
        release_torch_memory()

    @staticmethod
    def _notify(request: PipelineRequest, stage: str, progress: float, detail: str) -> None:
        if callable(request.cancelled) and request.cancelled():
            raise ProcessingCancelledError("Song processing cancelled")
        if callable(request.progress):
            request.progress(stage, progress, detail)

    @staticmethod
    def _stage(
        reports: list[StageReport], name: str, engine: str, started: float, *, role: str | None = None,
    ) -> None:
        details: dict[str, object] = {"rss_bytes": _process_rss_bytes()}
        allocated, reserved = _cuda_memory_bytes()
        if allocated or reserved:
            details["cuda_allocated_bytes"], details["cuda_reserved_bytes"] = allocated, reserved
        backend = get_runtime_plan().selected.get(role) if role is not None else None
        if backend is not None:
            details["device"], details["dtype"] = backend.device, backend.precision
        reports.append(StageReport(name, time.perf_counter() - started, False, engine, details))

    def _lyrics(
        self,
        request: PipelineRequest,
        vocals: Path,
        discovery: Future[LyricsDiscovery | None] | None = None,
    ) -> tuple[str, list[Word], tuple[TimedLine, ...]]:
        if request.lyrics_path and Path(request.lyrics_path).is_file():
            text = Path(request.lyrics_path).read_text(encoding="utf-8").strip()
            return text, [], ()
        found = discovery.result() if discovery else discover_lyrics(request.title)
        if found:
            print(
                f"[AI] lyrics source={found.source} timed_lines={len(found.lines)}",
                flush=True,
            )
            return found.text, [], found.lines
        print("[AI] lyrics source=ASR timed_lines=0", flush=True)
        text, words = self.engines.transcriber.transcribe(vocals, request.language)
        return text, words, ()

    def _align(
        self,
        vocals: Path,
        text: str,
        language: str | None,
        direct: list[Word],
        timed_lines: tuple[TimedLine, ...] = (),
    ) -> list[Word]:
        if direct:
            return [Word(word.start, word.end, word.text, word.confidence, index) for index, word in enumerate(direct)]
        try:
            if timed_lines and hasattr(self.engines.aligner, "align_timed_lines"):
                words = self.engines.aligner.align_timed_lines(
                    vocals, text, timed_lines, language
                )
            else:
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
        # Keep expensive model weights warm in system RAM between jobs while
        # returning their CUDA memory to the separator. Reloading Qwen's
        # checkpoint shards from disk added tens of seconds to every song.
        self._park_engines(
            self.engines.pitch, self.engines.transcriber, self.engines.aligner
        )

        with (
            tempfile.TemporaryDirectory(prefix=".ai-clean-", dir=output) as temporary,
            ThreadPoolExecutor(max_workers=2, thread_name_prefix="ai-independent") as parallel,
            audio_buffer_cache(),
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
            try:
                self.engines.separator.separate(
                    mix, raw_vocals, instrumental,
                    profile=profile, cancelled=request.cancelled,
                )
            finally:
                # MSST lives in a child process and keeps its CUDA model loaded
                # after returning. On 8 GB GPUs that leaves too little VRAM for
                # the forced aligner, causing minutes of paging at the lyrics
                # stage. Jobs are serialized, so retaining this worker brings
                # no useful throughput; release it before loading later models.
                getattr(self.engines.separator, "close", lambda: None)()
            self._stage(reports, "separate", self.engines.separator.name, started, role="separation")

            music_started = time.perf_counter()
            music_future = parallel.submit(analyze_music, instrumental)

            self._notify(request, "vocal", 42, "Очистка и перевод голоса в моно")
            started = time.perf_counter()
            prepare_vocal_reference(raw_vocals, vocals, self.config.sample_rate)
            self._stage(reports, "vocal", "ffmpeg-mono-clean", started)

            self._notify(request, "analysis", 48, "Анализ музыки и мелодии по vocals.flac")
            pitch_started = time.perf_counter()
            try:
                pitch = stabilize_pitch(self.engines.pitch.estimate(vocals))
            finally:
                self._park_engines(self.engines.pitch)
            self._stage(reports, "pitch", self.engines.pitch.name, pitch_started, role="pitch")
            music = music_future.result()
            self._stage(reports, "music", "librosa", music_started)

            self._notify(request, "transcribe", 70, "Получение и распознавание текста")
            started = time.perf_counter()
            text, direct, timed_lines = self._lyrics(request, vocals, discovery)
            if not text:
                raise EngineUnavailableError("Lyrics and ASR transcript are unavailable")
            self._notify(request, "align", 84, "Синхронизация слов с голосом")
            try:
                words = self._align(vocals, text, request.language, direct, timed_lines)
            finally:
                self._park_engines(self.engines.transcriber, self.engines.aligner)
            # Timed-line alignment already uses short acoustic windows anchored
            # by the provider's LRC timestamps. Re-anchoring those words against
            # global VAD can merge repeated adjacent lines and collapse one of
            # them to a fraction of a second. The VAD repair remains valuable
            # for un-timed whole-song/ASR alignment only.
            if not timed_lines and getattr(
                self.engines.aligner, "needs_voice_anchoring", True
            ):
                words = anchor_words_to_voice(
                    words, voice_activity_intervals(vocals), duration(vocals)
                )
            self._stage(reports, "lyrics", self.engines.aligner.name, started, role="aligner")

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
        timed_lines: tuple[TimedLine, ...] = ()
        if request.title:
            found = discover_lyrics(request.title)
            if found and found.lines:
                canonical = [token.casefold() for token in tokenize(text)]
                discovered = [token.casefold() for token in tokenize(found.text)]
                if canonical == discovered:
                    timed_lines = found.lines

        with audio_buffer_cache():
            self._notify(request, "analysis", 48, "Анализ мелодии по vocals.flac")
            started = time.perf_counter()
            try:
                pitch = stabilize_pitch(self.engines.pitch.estimate(vocals))
            finally:
                self._park_engines(self.engines.pitch)
            self._stage(reports, "pitch", self.engines.pitch.name, started, role="pitch")

            self._notify(request, "align", 70, "Синхронизация текста по vocals.flac")
            started = time.perf_counter()
            try:
                words = self._align(vocals, text, request.language, [], timed_lines)
            finally:
                self._park_engines(self.engines.transcriber, self.engines.aligner)
            if not timed_lines and getattr(
                self.engines.aligner, "needs_voice_anchoring", True
            ):
                words = anchor_words_to_voice(
                    words, voice_activity_intervals(vocals), duration(vocals)
                )
            self._stage(reports, "lyrics", self.engines.aligner.name, started, role="aligner")

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
