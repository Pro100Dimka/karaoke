from __future__ import annotations

import re
import shutil
import sys
import tempfile
import time
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from .artifacts import publish_files_atomically
from .audio import audio_buffer_cache, decode_audio, duration, encode_flac
from .cache import StageCache
from .config import CoreConfig
from .engines.ctc_alignment import CTC_ALIGNMENT_VERSION
from .engines.pitch import PyinFallbackPitchEstimator
from .engines.registry import EngineRegistry
from .engines.separation import CenterChannelFallbackSeparator
from .engines.text import (
    ASR_PIPELINE_VERSION,
    LONG_TEXT_ALIGNMENT_VERSION,
    UniformTextFallback,
    resolve_alignment_language,
)
from .errors import EngineUnavailableError, ProcessingCancelledError
from .locks import ThreadFileLock
from .lyrics_document import validate_lyrics_document, words_with_notes
from .lyrics_sources import discover_lyrics
from .models import (
    PitchFrame,
    StageReport,
    Word,
    to_dict,
)
from .music import MUSIC_ANALYZER_VERSION, analyze_music
from .notes import NOTE_DECODER_VERSION, build_vocal_notes
from .pitch_post import (
    PITCH_STABILIZER_VERSION,
    fuse_pitch_with_yin,
    refine_pitch_confidence,
    stabilize_pitch,
)
from .processing_modes import resolve_processing_profile
from .profiler import RuntimeTelemetry
from .syllables import align_syllables
from .utils.io import read_json, write_json_atomic, write_text_atomic
from .validators import (
    validate_audio,
    validate_json,
    validate_music_json,
    validate_pitch,
    validate_pitch_json,
    validate_timeline,
    validate_within_duration,
    validate_words_json,
)
from .version import AI_BUILD_ID
from .vocal_preprocess import (
    VOCAL_REFERENCE_PREPROCESS_VERSION,
    prepare_vocal_reference,
    validate_vocal_reference,
)

ProgressCallback = Callable[[str, float, str], None]
CancelCallback = Callable[[], bool]
PIPELINE_LOCK_TIMEOUT_SECONDS = 180.0


def _lyrics_console(*parts: object) -> None:
    text, stream = ' '.join(str(part) for part in parts), getattr(
        sys, '__stdout__', None) or sys.stdout
    try:
        if hasattr(stream, "reconfigure") and getattr(stream, "encoding", "").lower() != "utf-8":
            stream.reconfigure(encoding="utf-8", errors="replace")
        print(text, file=stream, flush=True)
    except (OSError, ValueError, UnicodeError):
        pass


def _lyrics_language_hint(value: str | None) -> str | None:
    text = str(value or "").casefold()
    if any(ch in text for ch in "іїєґ"):
        return "uk"
    return 'ru' if re.search('[а-яё]', text) else None


def _print_full_lyrics(source: str, text: str, query: str | None) -> None:
    line_count = len([line for line in text.splitlines() if line.strip()])
    _lyrics_console(
        f"[lyrics] result: source={source or 'unknown'} query={query or '<empty>'!r} "
        f"lines={line_count} chars={len(text)}"
    )


class _OutputDirectoryLock(ThreadFileLock):

    def __init__(self, output: Path, timeout_sec: float = 30.0): super().__init__(
        Path(output) / '.pipeline.lock', timeout_sec=timeout_sec)


@dataclass(frozen=True)
class PipelineRequest:
    source_path: str | Path
    output_dir: str | Path
    language: str | None = None
    lyrics_path: str | Path | None = None
    title: str | None = None
    progress: ProgressCallback | None = None
    cancelled: CancelCallback | None = None
    bpm_override: float | None = None
    key_override: str | None = None
    processing_mode: str = "auto"


@dataclass(frozen=True)
class PipelineResult:
    output_dir: Path
    manifest_path: Path
    warnings: tuple[str, ...]
    reports: tuple[StageReport, ...]


class KaraokePipeline:
    VERSION = f"2026.37-{AI_BUILD_ID}"

    def __init__(
        self,
        config: CoreConfig | None = None,
        engines: EngineRegistry | None = None,
    ):
        self.config = config or CoreConfig.from_env()
        self.engines = engines or EngineRegistry.create_default(self.config)

    def close(self) -> None:
        if (close := getattr(self.engines.separator, "close", None)) is not None:
            close()

    @staticmethod
    def _remove_stale(*paths: Path) -> None:
        for path in paths:
            with suppress(OSError):
                path.unlink(missing_ok=True)

    @staticmethod
    def _publish_text_alignment(
        output: Path, lyrics_txt: Path, words_path: Path, text: str, words: list[Word]
    ) -> None:
        with tempfile.TemporaryDirectory(prefix="karaoke-text-", dir=output) as temp_dir:
            root = Path(temp_dir)
            temp_text = root / "lyrics.txt"
            temp_words = root / "lyricsSync.json"
            write_text_atomic(temp_text, text.strip() + "\n")
            write_json_atomic(
                temp_words,
                {"text": text, "words": [to_dict(word) for word in words]},
                compact=True,
            )
            validate_json(temp_words, ("text", "words"))
            publish_files_atomically(
                [(temp_text, lyrics_txt), (temp_words, words_path)])

    def _cache_hit(
        self, cache: StageCache, stage: str, key: str, outputs: list[Path], validators=None
    ) -> bool:
        if not self.config.validate_cached_artifacts:
            validators = None
        return cache.hit(stage, key, outputs, validators=validators)

    def _cached_stage(
        self,
        cache: StageCache,
        reports: list[StageReport],
        stage: str,
        key: str,
        outputs: list[Path],
        validators=None,
        *,
        details: str = "cached",
    ) -> bool:
        if not self._cache_hit(cache, stage, key, outputs, validators):
            return False
        self._report(reports, stage, details, cached=True)
        return True

    def _complete_stage(
        self,
        cache: StageCache,
        reports: list[StageReport],
        stage: str,
        key: str,
        outputs: list[Path],
        details: str,
        *,
        started=None,
    ) -> None:
        cache.commit(stage, key, outputs)
        self._report(reports, stage, details, started=started)

    def _notify(self, request: PipelineRequest, stage: str, progress: float, message: str):
        if request.cancelled and request.cancelled():
            raise ProcessingCancelledError("AI processing was cancelled")
        if request.progress:
            request.progress(stage, max(0.0, min(100.0, progress)), message)

    @staticmethod
    def _report(reports, name, engine, *, started=None, cached=False):
        reports.append(StageReport(
            name, 0.0 if started is None else time.perf_counter() - started, cached, engine
        ))

    def _run(self, name, engine, function, reports, warnings):
        started = time.perf_counter()
        try:
            result = function(engine)
            used = engine.name
        except EngineUnavailableError as exc:
            if not self.config.allow_fallback:
                raise
            warnings.append(str(exc))
            fallbacks = {
                "separation": CenterChannelFallbackSeparator(),
                "pitch": PyinFallbackPitchEstimator(
                    self.config.pitch_sample_rate,
                    self.config.hop_seconds,
                    self.config.fmin_hz,
                    self.config.fmax_hz,
                ),
                "transcription": UniformTextFallback(),
                "alignment": UniformTextFallback(),
            }
            fallback = fallbacks[name.split("-", 1)[0]]
            result = function(fallback)
            used = fallback.name
        self._report(reports, name, used, started=started)
        return result

    def run(self, request: PipelineRequest) -> PipelineResult:
        output = Path(request.output_dir).resolve()
        output.mkdir(parents=True, exist_ok=True)
        lock_path = output / ".pipeline.lock"
        try:
            with ThreadFileLock(lock_path, timeout_sec=PIPELINE_LOCK_TIMEOUT_SECONDS):
                return self._run_unlocked(request)
        finally:
            self._remove_stale(lock_path)

    def _run_unlocked(self, request: PipelineRequest) -> PipelineResult:
        telemetry = RuntimeTelemetry()
        with telemetry, audio_buffer_cache():
            return self._run_profiled(request, telemetry)

    def _run_profiled(
        self, request: PipelineRequest, telemetry: RuntimeTelemetry
    ) -> PipelineResult:
        source, output = Path(request.source_path).resolve(), Path(
            request.output_dir).resolve()
        output.mkdir(parents=True, exist_ok=True)
        if not source.is_file():
            raise FileNotFoundError(source)
        protected_outputs = {
            (output / "song.wav").resolve(),
            (output / "vocals.flac").resolve(),
            (output / "instrumental.flac").resolve(),
        }
        if source in protected_outputs:
            raise ValueError(
                "source_path cannot point to a pipeline-generated audio artifact")

        cache = StageCache(output / ".ai-cache")
        reports: list[StageReport] = []
        alignment_debug_raw: dict[str, object] = {}
        warnings: list[str] = []
        processing_profile = resolve_processing_profile(request.processing_mode)
        source_hash, song_wav = cache.file_hash(source), output / "song.wav"
        vocals, instrumental = output / "vocals.flac", output / "instrumental.flac"

        self._notify(request, "decode", 2, "Подготовка аудио")
        decode_key = cache.key(
            "decode", {"source": source_hash, "sr": self.config.sample_rate})
        if self._cached_stage(
            cache,
            reports,
            "decode",
            decode_key,
            [song_wav],
            {song_wav: validate_audio},
            details="ffmpeg",
        ):
            pass
        else:
            started = time.perf_counter()
            with tempfile.TemporaryDirectory(prefix="karaoke-decode-", dir=output) as temp_dir:
                temporary_song = Path(temp_dir) / "song.wav"
                decode_audio(source, temporary_song, self.config.sample_rate)
                validate_audio(temporary_song)
                if cache.file_hash(source) != source_hash:
                    raise RuntimeError(
                        "Source audio changed during decoding; retry with a stable file"
                    )
                publish_files_atomically([(temporary_song, song_wav)])
            self._complete_stage(
                cache, reports, "decode", decode_key, [song_wav], "ffmpeg", started=started
            )

        song_duration, supplied = duration(song_wav), ''
        effective_language, asr_language, lyrics_source, lyrics_query = request.language, request.language or _lyrics_language_hint(
            request.title), None, request.title
        if request.lyrics_path and Path(request.lyrics_path).exists():
            supplied = Path(request.lyrics_path).read_text(
                encoding="utf-8-sig").strip()
            lyrics_source = "explicit"
        if not supplied:
            discovery = discover_lyrics(
                source,
                title=request.title,
                duration_sec=song_duration,
            )
            supplied = discovery.text
            lyrics_source = discovery.source
            lyrics_query = discovery.query or request.title

        if supplied:
            _print_full_lyrics(lyrics_source or "unknown",
                               supplied, lyrics_query)
        else:
            if asr_language:
                _lyrics_console(
                    f"[lyrics] ASR language forced: {asr_language}")

        self._notify(request, "separation", 8, "Выделение вокала и минуса")
        separation_key = cache.key(
            "separation",
            {
                "song": cache.file_hash(song_wav),
                "engine": self.engines.separator.name,
                "command": getattr(self.engines.separator, "command", None),
                "config": cache.optional_file_hash(getattr(self.engines.separator, "config", None)),
                "checkpoint": cache.optional_file_hash(
                    getattr(self.engines.separator, "checkpoint", None)
                ),
                "engine_code": cache.optional_file_hash(
                    (Path(getattr(self.engines.separator,
                     "engine_dir", "")) / "inference.py")
                    if getattr(self.engines.separator, "engine_dir", None)
                    else None
                ),
                "demix_code": cache.optional_file_hash(
                    (
                        Path(getattr(self.engines.separator, "engine_dir", ""))
                        / "utils"
                        / "model_utils.py"
                    )
                    if getattr(self.engines.separator, "engine_dir", None)
                    else None
                ),
                "vocal_reference": VOCAL_REFERENCE_PREPROCESS_VERSION,
                "processing_profile": processing_profile.fingerprint(),
            },
        )
        separation_cached = self._cache_hit(
            cache,
            "separation",
            separation_key,
            [vocals, instrumental],
            {vocals: validate_vocal_reference, instrumental: validate_audio},
        )
        if separation_cached:
            self._report(reports, "separation", "cached", cached=True)
        else:
            with tempfile.TemporaryDirectory(prefix="karaoke-stems-", dir=output) as temp_dir:
                temporary_vocals = Path(temp_dir) / "vocals.wav"
                cleaned_vocals = Path(temp_dir) / "vocals-clean-mono.wav"
                temporary_instrumental = Path(temp_dir) / "instrumental.wav"
                self._run(
                    "separation",
                    self.engines.separator,
                    lambda engine: engine.separate(
                        song_wav,
                        temporary_vocals,
                        temporary_instrumental,
                        profile=processing_profile,
                    ),
                    reports,
                    warnings,
                )
                validate_audio(temporary_vocals)
                validate_audio(temporary_instrumental)
                prepare_vocal_reference(
                    temporary_vocals,
                    cleaned_vocals,
                    wpe_iterations=processing_profile.wpe_iterations,
                )
                validate_vocal_reference(cleaned_vocals)
                encoded_vocals = Path(temp_dir) / "vocals.flac"
                encoded_instrumental = Path(temp_dir) / "instrumental.flac"
                encode_flac(cleaned_vocals, encoded_vocals)
                encode_flac(temporary_instrumental, encoded_instrumental)
                publish_files_atomically(
                    [
                        (encoded_vocals, vocals),
                        (encoded_instrumental, instrumental),
                    ]
                )
            cache.commit("separation", separation_key, [vocals, instrumental])

        vocal_fingerprint, instrumental_fingerprint = vocals, instrumental

        self._notify(request, "tempo", 48, "Анализ темпа")
        music_path, tempo_key = output / 'music.json', cache.key('tempo', {'instrumental': cache.file_hash(
            instrumental_fingerprint), 'engine': MUSIC_ANALYZER_VERSION, 'bpm_override': request.bpm_override, 'key_override': request.key_override})
        if request.bpm_override is not None:
            override_bpm = float(request.bpm_override)
            if not 20.0 <= override_bpm <= 300.0:
                raise ValueError(
                    f"bpm_override must be between 20 and 300, got {override_bpm}")
        else:
            override_bpm = None
        override_key = str(request.key_override).strip(
        ) if request.key_override is not None else ""

        if self._cached_stage(
            cache, reports, "tempo", tempo_key, [
                music_path], {music_path: validate_music_json}
        ):
            music_analysis = read_json(music_path, {})
            bpm = int(round(float(music_analysis.get("bpm") or 120.0)))
        else:
            started = time.perf_counter()
            music_analysis = (
                {
                    "bpm": int(round(override_bpm)),
                    "tempo_confidence": 1.0,
                    "tempo_source": "override",
                    "key": override_key,
                    "key_confidence": 1.0,
                    "key_source": "override",
                }
                if override_bpm is not None and override_key
                else analyze_music(instrumental)
            )
            if override_bpm is not None:
                music_analysis["bpm"] = int(round(override_bpm))
                music_analysis["tempo_confidence"] = 1.0
                music_analysis["tempo_source"] = "override"
            if override_key:
                music_analysis["key"] = override_key
                music_analysis["key_confidence"] = 1.0
                music_analysis["key_source"] = "override"
            bpm = int(round(float(music_analysis.get("bpm") or 120.0)))
            music_analysis["bpm"] = bpm
            write_json_atomic(music_path, music_analysis)
            self._complete_stage(
                cache,
                reports,
                "tempo",
                tempo_key,
                [music_path],
                "override" if override_bpm is not None or override_key else "librosa-beat",
                started=started,
            )

        self._notify(request, "pitch", 52, "Определение нот по vocals.flac")
        pitch_raw_path, pitch_path = output / 'pitchRaw.json', output / 'pitch.json'

        pitch_key, pitch_outputs = cache.key('pitch', {'vocals': cache.file_hash(vocal_fingerprint), 'engine': self.engines.pitch.name, 'engine_config': getattr(self.engines.pitch, 'fingerprint', lambda: {})(), 'hop': self.config.hop_seconds, 'fmin': self.config.fmin_hz,
                                             'fmax': self.config.fmax_hz, 'postprocessor': PITCH_STABILIZER_VERSION, 'pitch_post_code': cache.optional_file_hash(Path(__file__).with_name('pitch_post.py'))}), [pitch_raw_path, pitch_path] if self.config.preserve_raw_pitch else [pitch_path]
        pitch_validators = {
            path: validate_pitch_json for path in pitch_outputs}
        if self._cache_hit(cache, "pitch", pitch_key, pitch_outputs, pitch_validators):
            pitch = [PitchFrame(**item) for item in read_json(pitch_path, [])]
            self._report(reports, "pitch", "cached", cached=True)
        else:
            raw_pitch = list(self._run(
                "pitch-vocals", self.engines.pitch,
                lambda engine: engine.estimate(vocals), reports, warnings,
            ))
            validate_pitch(raw_pitch)
            confidence_pitch = refine_pitch_confidence(
                raw_pitch, vocals, sample_rate=self.config.pitch_sample_rate
            )
            validate_pitch(confidence_pitch)
            stabilization_input = fuse_pitch_with_yin(
                confidence_pitch,
                vocals,
                sample_rate=self.config.pitch_sample_rate,
                fmin_hz=self.config.fmin_hz,
                fmax_hz=self.config.fmax_hz,
            )
            validate_pitch(stabilization_input)
            pitch = stabilize_pitch(stabilization_input)
            validate_pitch(pitch)
            pitch_outputs = [pitch_path]
            if self.config.preserve_raw_pitch:
                write_json_atomic(
                    pitch_raw_path, [to_dict(frame) for frame in raw_pitch])
                pitch_outputs.insert(0, pitch_raw_path)
            else:
                self._remove_stale(pitch_raw_path)
            write_json_atomic(pitch_path, [to_dict(frame) for frame in pitch])
            cache.commit("pitch", pitch_key, pitch_outputs)
        validate_within_duration(pitch, song_duration,
                                 "pitch", self.config.hop_seconds * 2)
        if hasattr(self.engines.aligner, "set_pitch_activity"):
            self.engines.aligner.set_pitch_activity(pitch)

        lyrics_txt, words_path, text_hash = output / 'lyrics.txt', output / \
            'lyricsSync.json', StageCache.key('text', {'text': supplied})

        self._notify(
            request,
            "alignment" if supplied else "transcription",
            70,
            "Синхронизация готового текста" if supplied else "Распознавание текста песни",
        )
        if supplied:
            effective_language = resolve_alignment_language(
                supplied, effective_language)
            alignment_key = cache.key(
                "alignment",
                {
                    "vocals": cache.file_hash(vocal_fingerprint),
                    "text": text_hash,
                    "language": effective_language,
                    "engine": self.engines.aligner.name,
                    "model": getattr(self.engines.aligner, "model_name", None),
                    "long_text_algorithm": LONG_TEXT_ALIGNMENT_VERSION,
                    "ctc_alignment_algorithm": CTC_ALIGNMENT_VERSION,
                    "ctc_models": getattr(
                        getattr(self.engines.aligner,
                                "_ctc", None), "models", {}
                    ),
                },
            )
            alignment_outputs = [lyrics_txt, words_path]
            alignment_validators = {
                words_path: lambda path: validate_json(path, ("text", "words")),
            }
            if self._cache_hit(
                cache, "alignment", alignment_key, alignment_outputs, alignment_validators
            ):
                raw = read_json(words_path, {})
                words = [Word(**item) for item in raw.get("words", [])]
                self._publish_text_alignment(
                    output, lyrics_txt, words_path, supplied, words)
                cache.commit("alignment", alignment_key, alignment_outputs)
            else:
                words = self._run(
                    "alignment",
                    self.engines.aligner,
                    lambda engine: (
                        engine.align_long_text(
                            vocals, supplied, effective_language)
                        if callable(getattr(engine, "align_long_text", None))
                        else engine.align(vocals, supplied, effective_language)
                    ),
                    reports,
                    warnings,
                )
                alignment_diagnostics = (
                    getattr(self.engines.aligner,
                            "last_alignment_diagnostics", None) or {}
                )
                if alignment_diagnostics:
                    alignment_debug_raw = {
                        "word_sources": list(alignment_diagnostics.get("word_sources") or []),
                        "word_candidates": list(alignment_diagnostics.get("word_candidates") or []),
                    }
                    public_alignment_diagnostics = {
                        key: value
                        for key, value in alignment_diagnostics.items()
                        if key not in {"word_sources", "word_candidates"}
                    }
                    alignment_debug_raw["model_evidence"] = public_alignment_diagnostics
                    details = " ".join(
                        f"{key}={value}" for key, value in public_alignment_diagnostics.items()
                    )
                    self._report(reports, "alignment-acoustic", details)
                validate_timeline(words, "words")
                self._publish_text_alignment(
                    output, lyrics_txt, words_path, supplied, words)
                cache.commit("alignment", alignment_key, alignment_outputs)
        else:
            transcription_key = cache.key(
                "transcription",
                {
                    "vocals": cache.file_hash(vocal_fingerprint),
                    "language": asr_language,
                    "engine": self.engines.transcriber.name,
                    "model": getattr(self.engines.transcriber, "model_name", None),
                    "algorithm": ASR_PIPELINE_VERSION,
                    "aligner": self.engines.aligner.name,
                    "aligner_model": getattr(self.engines.aligner, "model_name", None),
                },
            )
            if self._cache_hit(
                cache,
                "transcription",
                transcription_key,
                [lyrics_txt, words_path],
                {words_path: validate_words_json},
            ):
                text = lyrics_txt.read_text(encoding="utf-8")
                words = [
                    Word(**item) for item in read_json(words_path, {}).get("words", [])
                ]
                self._publish_text_alignment(
                    output, lyrics_txt, words_path, text, words)
                cache.commit("transcription", transcription_key,
                             [lyrics_txt, words_path])
            else:
                if hasattr(self.engines.transcriber, "set_pitch_activity"):
                    self.engines.transcriber.set_pitch_activity(pitch)
                text, words = self._run(
                    "transcription",
                    self.engines.transcriber,
                    lambda engine: engine.transcribe(vocals, asr_language),
                    reports,
                    warnings,
                )
                if not effective_language:
                    effective_language = getattr(
                        self.engines.transcriber, "last_language", None)
                if text and not words:
                    self._notify(request, "alignment", 78,
                                 "Синхронизация распознанных слов")
                    effective_language = resolve_alignment_language(
                        text, effective_language)
                    segments = getattr(
                        self.engines.transcriber, "last_segments", None)
                    words = self._run(
                        "alignment",
                        self.engines.aligner,
                        lambda engine: (
                            engine.align_segments(
                                vocals, segments, effective_language)
                            if segments and callable(getattr(engine, "align_segments", None))
                            else engine.align(vocals, text, effective_language)
                        ),
                        reports,
                        warnings,
                    )
                validate_timeline(words, "words")
                self._publish_text_alignment(
                    output, lyrics_txt, words_path, text, words)
                cache.commit("transcription", transcription_key,
                             [lyrics_txt, words_path])

            _print_full_lyrics("ASR", text, request.title)

        validate_within_duration(words, song_duration, "words", 0.5)

        self._notify(request, "notes", 82,
                     "Построение нот голоса по vocals.flac")
        started = time.perf_counter()
        syllables = align_syllables(words, pitch)
        vocal_notes = build_vocal_notes(
            pitch,
            syllables,
            min_note=self.config.min_note_sec,
            split_semitones=self.config.split_note_semitones,
            max_gap=self.config.max_gap_sec,
            min_confidence=self.config.min_voiced_confidence,
            words=words,
            audio=vocals,
            activity_segments=(),
            fmin_hz=self.config.fmin_hz,
            fmax_hz=self.config.fmax_hz,
        )
        validate_timeline(words, "words")
        validate_timeline(syllables, "syllables")
        validate_timeline(vocal_notes, "vocal notes")
        validate_within_duration(syllables, song_duration, "syllables", 0.5)
        validate_within_duration(
            vocal_notes, song_duration, "vocal notes", 0.1)
        self._report(reports, "notes", "vocals", started=started)

        lyrics_payload = read_json(words_path, {})
        lyrics_payload.update({
            "reference_audio": "vocals.flac",
            "duration": round(song_duration, 3),
            "bpm": bpm,
            "key": str(music_analysis.get("key") or "unknown"),
            "note_decoder": NOTE_DECODER_VERSION,
            "words": words_with_notes(words, vocal_notes),
        })
        validate_lyrics_document(lyrics_payload)
        write_json_atomic(words_path, lyrics_payload, compact=True)

        outputs = {
            "vocals": "vocals.flac",
            "instrumental": "instrumental.flac",
            "lyricsSync": "lyricsSync.json",
        }

        self._notify(request, "validate", 98, "Проверка результата")
        for relative in outputs.values():
            artifact = output / relative
            if not artifact.is_file():
                raise FileNotFoundError(
                    f"Runtime artifact is missing: {artifact}")
        self._remove_stale(song_wav)
        for name in (
            "music.json", "lyrics.txt", "pitch.json", "pitchRaw.json",
            "syllables.json", "reference.json", "acousticNotes.json",
            "melodyContour.json", "songInfo.json",
            "lyrics.json", "difficulty.json", "quality.json", "diagnostics.json",
            "alignmentDebug.json", "performance.json", "structure.json",
            "breaths.json", "vocal.mid", "game.mid",
            "song.mp3", "trusted_lyrics.txt",
            "separated/vocals.midi-analysis.wav",
            "separated/vocals.midi-analysis-tail.wav",
        ):
            self._remove_stale(output / name)
        shutil.rmtree(output / ".ai-cache", ignore_errors=True)
        shutil.rmtree(output / "logs", ignore_errors=True)
        shutil.rmtree(output / "separated", ignore_errors=True)
        self._notify(request, "complete", 100, "Готово")
        return PipelineResult(output, words_path, tuple(warnings), tuple(reports))
