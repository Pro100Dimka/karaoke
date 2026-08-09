from __future__ import annotations

import tempfile
import time
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from .artifacts import publish_files_atomically
from .audio import decode_audio, duration
from .cache import StageCache
from .config import CoreConfig
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
from .lyrics_sources import discover_lyrics
from .midi import write_midi
from .models import (
    PipelineManifest,
    PitchFrame,
    StageReport,
    Syllable,
    VocalNote,
    Word,
    to_dict,
)
from .music import MUSIC_ANALYZER_VERSION, analyze_music
from .notes import NOTE_DECODER_VERSION, build_game_notes, build_vocal_notes
from .pitch_post import PITCH_STABILIZER_VERSION, stabilize_pitch
from .profiler import environment_info
from .quality import evaluate_quality
from .syllables import SYLLABLE_ALIGNER_VERSION, align_syllables
from .utils.io import read_json, write_json_atomic, write_text_atomic
from .validators import (
    validate_audio,
    validate_derivation_json,
    validate_json,
    validate_midi,
    validate_music_json,
    validate_pitch,
    validate_pitch_json,
    validate_timeline,
    validate_within_duration,
    validate_words_json,
)

ProgressCallback = Callable[[str, float, str], None]
CancelCallback = Callable[[], bool]
PIPELINE_LOCK_TIMEOUT_SECONDS = 180.0


class _OutputDirectoryLock(ThreadFileLock):
    """Backward-compatible wrapper around the hardened v2 lock."""

    def __init__(self, output: Path, timeout_sec: float = 30.0):
        super().__init__(Path(output) / ".pipeline.lock", timeout_sec=timeout_sec)


@dataclass(frozen=True)
class PipelineRequest:
    source_path: str | Path
    output_dir: str | Path
    language: str | None = "ru"
    lyrics_path: str | Path | None = None
    title: str | None = None
    progress: ProgressCallback | None = None
    cancelled: CancelCallback | None = None


@dataclass(frozen=True)
class PipelineResult:
    output_dir: Path
    manifest_path: Path
    warnings: tuple[str, ...]
    reports: tuple[StageReport, ...]


class KaraokePipeline:
    VERSION = "2026.35"

    def __init__(
        self,
        config: CoreConfig | None = None,
        engines: EngineRegistry | None = None,
    ):
        self.config = config or CoreConfig.from_env()
        self.engines = engines or EngineRegistry.create_default(self.config)

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
            )
            validate_json(temp_words, ("text", "words"))
            publish_files_atomically([(temp_text, lyrics_txt), (temp_words, words_path)])

    @staticmethod
    def _publish_midi_pair(
        output: Path,
        vocal_midi: Path,
        game_midi: Path,
        vocal_notes,
        game_notes,
        words,
        syllables,
        bpm: float,
        bend_range: int,
    ) -> None:
        with tempfile.TemporaryDirectory(prefix="karaoke-midi-", dir=output) as temp_dir:
            root = Path(temp_dir)
            temp_vocal = root / "vocal.mid"
            temp_game = root / "game.mid"
            write_midi(temp_vocal, vocal_notes, words, syllables, bpm, True, bend_range)
            write_midi(
                temp_game, game_notes or vocal_notes, words, syllables, bpm, False, bend_range
            )
            validate_midi(temp_vocal)
            validate_midi(temp_game)
            publish_files_atomically([(temp_vocal, vocal_midi), (temp_game, game_midi)])

    def _cache_hit(
        self, cache: StageCache, stage: str, key: str, outputs: list[Path], validators=None
    ) -> bool:
        if not self.config.validate_cached_artifacts:
            validators = None
        return cache.hit(stage, key, outputs, validators=validators)

    def _notify(self, request: PipelineRequest, stage: str, progress: float, message: str):
        if request.cancelled and request.cancelled():
            raise ProcessingCancelledError("AI processing was cancelled")
        if request.progress:
            request.progress(stage, max(0.0, min(100.0, progress)), message)

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
            fallback = fallbacks[name]
            result = function(fallback)
            used = fallback.name
        reports.append(StageReport(name, time.perf_counter() - started, False, used))
        return result

    def run(self, request: PipelineRequest) -> PipelineResult:
        output = Path(request.output_dir).resolve()
        output.mkdir(parents=True, exist_ok=True)
        # A development launcher can briefly overlap the old and the restarted
        # backend. Wait for the real owner instead of marking a valid song as
        # failed after an arbitrary 30 seconds.
        with ThreadFileLock(output / ".pipeline.lock", timeout_sec=PIPELINE_LOCK_TIMEOUT_SECONDS):
            return self._run_unlocked(request)

    def _run_unlocked(self, request: PipelineRequest) -> PipelineResult:
        source = Path(request.source_path).resolve()
        output = Path(request.output_dir).resolve()
        output.mkdir(parents=True, exist_ok=True)
        if not source.is_file():
            raise FileNotFoundError(source)
        protected_outputs = {
            (output / "song.wav").resolve(),
            (output / "separated" / "vocals.wav").resolve(),
            (output / "separated" / "instrumental.wav").resolve(),
        }
        if source in protected_outputs:
            raise ValueError("source_path cannot point to a pipeline-generated audio artifact")

        cache = StageCache(output / ".ai-cache")
        reports: list[StageReport] = []
        warnings: list[str] = []
        source_hash = cache.file_hash(source)

        song_wav = output / "song.wav"
        vocals = output / "separated" / "vocals.wav"
        instrumental = output / "separated" / "instrumental.wav"
        vocals.parent.mkdir(exist_ok=True)

        self._notify(request, "decode", 2, "Подготовка аудио")
        decode_key = cache.key("decode", {"source": source_hash, "sr": self.config.sample_rate})
        if self._cache_hit(cache, "decode", decode_key, [song_wav], {song_wav: validate_audio}):
            reports.append(StageReport("decode", 0, True, "ffmpeg"))
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
            cache.commit("decode", decode_key, [song_wav])
            reports.append(StageReport("decode", time.perf_counter() - started, False, "ffmpeg"))

        song_duration = duration(song_wav)

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
            },
        )
        if self._cache_hit(
            cache,
            "separation",
            separation_key,
            [vocals, instrumental],
            {vocals: validate_audio, instrumental: validate_audio},
        ):
            reports.append(StageReport("separation", 0, True, "cached"))
        else:
            with tempfile.TemporaryDirectory(prefix="karaoke-stems-", dir=output) as temp_dir:
                temporary_vocals = Path(temp_dir) / "vocals.wav"
                temporary_instrumental = Path(temp_dir) / "instrumental.wav"
                compressed_vocals = next(
                    (
                        path
                        for suffix in (".flac", ".mp3")
                        if (path := vocals.with_suffix(suffix)).is_file()
                    ),
                    None,
                )
                compressed_instrumental = next(
                    (
                        path
                        for suffix in (".flac", ".mp3")
                        if (path := instrumental.with_suffix(suffix)).is_file()
                    ),
                    None,
                )
                if compressed_vocals and compressed_instrumental:
                    started = time.perf_counter()
                    decode_audio(compressed_vocals, temporary_vocals, self.config.sample_rate)
                    decode_audio(
                        compressed_instrumental,
                        temporary_instrumental,
                        self.config.sample_rate,
                    )
                    reports.append(
                        StageReport(
                            "separation",
                            time.perf_counter() - started,
                            True,
                            "compressed-stem-cache",
                        )
                    )
                else:
                    self._run(
                        "separation",
                        self.engines.separator,
                        lambda engine: engine.separate(
                            song_wav, temporary_vocals, temporary_instrumental
                        ),
                        reports,
                        warnings,
                    )
                validate_audio(temporary_vocals)
                validate_audio(temporary_instrumental)
                publish_files_atomically(
                    [
                        (temporary_vocals, vocals),
                        (temporary_instrumental, instrumental),
                    ]
                )
            cache.commit("separation", separation_key, [vocals, instrumental])

        # Post-processing stores large stems as lossless FLAC. Fingerprinting
        # that stable representation keeps tempo, pitch and alignment caches
        # valid across future incremental reprocessing runs.
        vocal_fingerprint = next(
            (
                path
                for suffix in (".flac", ".mp3")
                if (path := vocals.with_suffix(suffix)).is_file()
            ),
            vocals,
        )
        instrumental_fingerprint = next(
            (
                path
                for suffix in (".flac", ".mp3")
                if (path := instrumental.with_suffix(suffix)).is_file()
            ),
            instrumental,
        )

        self._notify(request, "tempo", 48, "Анализ темпа")
        music_path = output / "music.json"
        tempo_key = cache.key(
            "tempo",
            {
                "instrumental": cache.file_hash(instrumental_fingerprint),
                "engine": MUSIC_ANALYZER_VERSION,
            },
        )
        if self._cache_hit(
            cache, "tempo", tempo_key, [music_path], {music_path: validate_music_json}
        ):
            music_analysis = read_json(music_path, {})
            bpm = float(music_analysis.get("bpm", 120.0))
            reports.append(StageReport("tempo", 0, True, "cached"))
        else:
            started = time.perf_counter()
            music_analysis = analyze_music(instrumental)
            bpm = float(music_analysis["bpm"])
            write_json_atomic(music_path, music_analysis)
            cache.commit("tempo", tempo_key, [music_path])
            reports.append(
                StageReport("tempo", time.perf_counter() - started, False, "librosa-beat")
            )

        self._notify(request, "pitch", 52, "Определение мелодии голоса")
        pitch_raw_path = output / "pitchRaw.json"
        pitch_path = output / "pitch.json"
        pitch_key = cache.key(
            "pitch",
            {
                "vocals": cache.file_hash(vocal_fingerprint),
                "engine": self.engines.pitch.name,
                "engine_config": getattr(self.engines.pitch, "fingerprint", lambda: {})(),
                "hop": self.config.hop_seconds,
                "fmin": self.config.fmin_hz,
                "fmax": self.config.fmax_hz,
                "postprocessor": PITCH_STABILIZER_VERSION,
            },
        )
        pitch_outputs = (
            [pitch_raw_path, pitch_path] if self.config.preserve_raw_pitch else [pitch_path]
        )
        pitch_validators = {path: validate_pitch_json for path in pitch_outputs}
        if self._cache_hit(cache, "pitch", pitch_key, pitch_outputs, pitch_validators):
            pitch = [PitchFrame(**item) for item in read_json(pitch_path, [])]
            reports.append(StageReport("pitch", 0, True, "cached"))
        else:
            pitch = self._run(
                "pitch",
                self.engines.pitch,
                lambda engine: engine.estimate(vocals),
                reports,
                warnings,
            )
            raw_pitch = list(pitch)
            validate_pitch(raw_pitch)
            pitch = stabilize_pitch(raw_pitch)
            validate_pitch(pitch)
            pitch_outputs = [pitch_path]
            if self.config.preserve_raw_pitch:
                write_json_atomic(pitch_raw_path, [to_dict(frame) for frame in raw_pitch])
                pitch_outputs.insert(0, pitch_raw_path)
            else:
                self._remove_stale(pitch_raw_path)
            write_json_atomic(pitch_path, [to_dict(frame) for frame in pitch])
            cache.commit("pitch", pitch_key, pitch_outputs)
        validate_within_duration(pitch, song_duration, "pitch", self.config.hop_seconds * 2)

        def log_full_lyrics(text: str, source_name: str) -> None:
            value = str(text or "").strip()
            print(f"[lyrics] source={source_name}")
            print("[lyrics] ===== FULL LYRICS BEGIN =====")
            print(value if value else "<empty>")
            print("[lyrics] ===== FULL LYRICS END =====")

        supplied = ""
        supplied_segments: tuple[tuple[float, float, str], ...] = ()
        effective_language = request.language
        lyrics_source = None
        if request.lyrics_path and Path(request.lyrics_path).exists():
            supplied = Path(request.lyrics_path).read_text(encoding="utf-8-sig").strip()
            lyrics_source = "explicit"
        if not supplied:
            print(f"[lyrics] title search query: {request.title or '<none>'}")
            discovery = discover_lyrics(
                source,
                title=request.title,
                duration_sec=song_duration,
                allow_local=False,
            )
            supplied = discovery.text
            supplied_segments = discovery.segments
            lyrics_source = discovery.source
            if supplied:
                warnings.append(f"Using trusted {lyrics_source} lyrics instead of ASR")
                log_full_lyrics(supplied, lyrics_source or "online")
            else:
                print("[lyrics] title search found nothing; falling back to ASR")
        lyrics_txt = output / "lyrics.txt"
        words_path = output / "lyricsSync.json"
        text_hash = StageCache.key("text", {"text": supplied})

        self._notify(
            request,
            "alignment" if supplied else "transcription",
            70,
            "Синхронизация готового текста" if supplied else "Распознавание текста песни",
        )
        if supplied:
            effective_language = resolve_alignment_language(supplied, effective_language)
            alignment_key = cache.key(
                "alignment",
                {
                    "vocals": cache.file_hash(vocal_fingerprint),
                    "text": text_hash,
                    "language": effective_language,
                    "engine": self.engines.aligner.name,
                    "model": getattr(self.engines.aligner, "model_name", None),
                    "long_text_algorithm": LONG_TEXT_ALIGNMENT_VERSION,
                    "timed_segments": supplied_segments,
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
                reports.append(StageReport("alignment", 0, True, "cached"))
            else:
                words = self._run(
                    "alignment",
                    self.engines.aligner,
                    lambda engine: (
                        engine.align_segments(vocals, supplied_segments, effective_language)
                        if supplied_segments and callable(getattr(engine, "align_segments", None))
                        else (
                            engine.align_long_text(vocals, supplied, effective_language)
                            if len(supplied.split()) >= 60
                            and callable(getattr(engine, "align_long_text", None))
                            else engine.align(vocals, supplied, effective_language)
                        )
                    ),
                    reports,
                    warnings,
                )
                validate_timeline(words, "words")
                self._publish_text_alignment(output, lyrics_txt, words_path, supplied, words)
                cache.commit("alignment", alignment_key, alignment_outputs)
        else:
            transcription_key = cache.key(
                "transcription",
                {
                    "vocals": cache.file_hash(vocal_fingerprint),
                    "language": request.language,
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
                words = [Word(**item) for item in read_json(words_path, {}).get("words", [])]
                reports.append(StageReport("transcription", 0, True, "cached"))
                log_full_lyrics(text, "ASR cached")
            else:
                if hasattr(self.engines.transcriber, "set_pitch_activity"):
                    self.engines.transcriber.set_pitch_activity(pitch)
                text, words = self._run(
                    "transcription",
                    self.engines.transcriber,
                    lambda engine: engine.transcribe(vocals, request.language),
                    reports,
                    warnings,
                )
                log_full_lyrics(text, "ASR")
                if not effective_language:
                    effective_language = getattr(self.engines.transcriber, "last_language", None)
                if text and not words:
                    self._notify(request, "alignment", 78, "Синхронизация распознанных слов")
                    effective_language = resolve_alignment_language(text, effective_language)
                    segments = getattr(self.engines.transcriber, "last_segments", None)
                    words = self._run(
                        "alignment",
                        self.engines.aligner,
                        lambda engine: (
                            engine.align_segments(vocals, segments, effective_language)
                            if segments and callable(getattr(engine, "align_segments", None))
                            else engine.align(vocals, text, effective_language)
                        ),
                        reports,
                        warnings,
                    )
                validate_timeline(words, "words")
                self._publish_text_alignment(output, lyrics_txt, words_path, text, words)
                cache.commit("transcription", transcription_key, [lyrics_txt, words_path])
        validate_within_duration(words, song_duration, "words", 0.5)

        self._notify(request, "syllables", 82, "Разметка слогов и нот")
        syllable_path = output / "syllables.json"
        reference = output / "reference.json"
        contour = output / "melodyContour.json"
        notes_path = output / ".ai-cache" / "vocal-notes.json"
        derivation_key = cache.key(
            "derivation",
            {
                "pitch": cache.file_hash(pitch_path),
                "words": cache.file_hash(words_path),
                "min_note": self.config.min_note_sec,
                "confidence": self.config.min_voiced_confidence,
                "split": self.config.split_note_semitones,
                "gap": self.config.max_gap_sec,
                "decoder": NOTE_DECODER_VERSION,
                "syllable_aligner": SYLLABLE_ALIGNER_VERSION,
            },
        )
        derivation_outputs = [syllable_path, reference, contour, notes_path]
        derivation_validators = {
            syllable_path: lambda path: validate_derivation_json(path, "syllables"),
            reference: lambda path: validate_derivation_json(path, "notes"),
            contour: lambda path: validate_derivation_json(path, "frames"),
            notes_path: lambda path: validate_derivation_json(path, "notes"),
        }
        if self._cache_hit(
            cache, "derivation", derivation_key, derivation_outputs, derivation_validators
        ):
            syllables = [
                Syllable(**item) for item in read_json(syllable_path, {}).get("syllables", [])
            ]
            game_notes = [VocalNote(**item) for item in read_json(reference, {}).get("notes", [])]
            vocal_notes = [VocalNote(**item) for item in read_json(notes_path, {}).get("notes", [])]
            reports.append(StageReport("derivation", 0, True, "cached"))
        else:
            started = time.perf_counter()
            syllables = align_syllables(words, pitch)
            vocal_notes = build_vocal_notes(
                pitch,
                syllables,
                min_note=self.config.min_note_sec,
                split_semitones=self.config.split_note_semitones,
                max_gap=self.config.max_gap_sec,
                min_confidence=self.config.min_voiced_confidence,
            )
            game_notes = build_game_notes(vocal_notes)
            validate_timeline(words, "words")
            validate_timeline(syllables, "syllables")
            validate_timeline(vocal_notes, "vocal notes")
            write_json_atomic(syllable_path, {"syllables": [to_dict(item) for item in syllables]})
            write_json_atomic(reference, {"notes": [to_dict(item) for item in game_notes]})
            write_json_atomic(contour, {"frames": [to_dict(item) for item in pitch]})
            write_json_atomic(notes_path, {"notes": [to_dict(item) for item in vocal_notes]})
            cache.commit("derivation", derivation_key, derivation_outputs)
            reports.append(
                StageReport("derivation", time.perf_counter() - started, False, "word-aware")
            )
        validate_within_duration(syllables, song_duration, "syllables", 0.5)
        validate_within_duration(vocal_notes, song_duration, "vocal notes", 0.1)
        validate_within_duration(game_notes, song_duration, "game notes", 0.1)

        self._notify(request, "midi", 90, "Создание MIDI")
        vocal_midi = output / "vocal.mid"
        game_midi = output / "game.mid"
        midi_key = cache.key(
            "midi",
            {
                "derivation": derivation_key,
                "bpm": round(bpm, 4),
                "bend": self.config.midi_bend_range,
            },
        )
        if vocal_notes and self._cache_hit(
            cache,
            "midi",
            midi_key,
            [vocal_midi, game_midi],
            {vocal_midi: validate_midi, game_midi: validate_midi},
        ):
            reports.append(StageReport("midi", 0, True, "cached"))
        elif vocal_notes:
            started = time.perf_counter()
            self._publish_midi_pair(
                output,
                vocal_midi,
                game_midi,
                vocal_notes,
                game_notes,
                words,
                syllables,
                bpm,
                self.config.midi_bend_range,
            )
            cache.commit("midi", midi_key, [vocal_midi, game_midi])
            reports.append(
                StageReport("midi", time.perf_counter() - started, False, "word-syllable-aware")
            )
        else:
            self._remove_stale(vocal_midi, game_midi)
            cache.invalidate("midi")
            warnings.append("No voiced notes detected; MIDI was not generated")

        song_map = output / "songMap.json"
        song_map_key = cache.key(
            "song-map",
            {
                "derivation": derivation_key,
                "duration": song_duration,
                "bpm": round(bpm, 6),
                "tempo": tempo_key,
            },
        )
        if self._cache_hit(
            cache,
            "song-map",
            song_map_key,
            [song_map],
            {
                song_map: lambda path: validate_json(
                    path, ("duration", "bpm", "words", "syllables", "notes")
                )
            },
        ):
            reports.append(StageReport("song-map", 0, True, "cached"))
        else:
            write_json_atomic(
                song_map,
                {
                    "duration": song_duration,
                    "bpm": bpm,
                    "words": [to_dict(word) for word in words],
                    "syllables": [to_dict(item) for item in syllables],
                    "notes": [to_dict(item) for item in game_notes],
                },
            )
            cache.commit("song-map", song_map_key, [song_map])
            reports.append(StageReport("song-map", 0.0, False, "builder"))

        quality_path = output / "quality.json"
        quality = evaluate_quality(song_duration, pitch, words, syllables, vocal_notes)
        if self.config.write_quality_report:
            write_json_atomic(quality_path, to_dict(quality))
        else:
            self._remove_stale(quality_path)
        warnings.extend(item for item in quality.warnings if item not in warnings)
        diagnostics_path = output / "diagnostics.json"
        write_json_atomic(
            diagnostics_path,
            {
                "environment": environment_info(),
                "quality": to_dict(quality),
                "stages": [to_dict(report) for report in reports],
                "cache_hits": sum(1 for report in reports if report.cached),
                "cache_misses": sum(1 for report in reports if not report.cached),
            },
        )

        outputs = {
            "song": "song.wav",
            "vocals": "separated/vocals.wav",
            "instrumental": "separated/instrumental.wav",
            "music": "music.json",
            "lyrics": "lyrics.txt",
            "lyricsSync": "lyricsSync.json",
            "pitch": "pitch.json",
            "syllables": "syllables.json",
            "reference": "reference.json",
            "melodyContour": "melodyContour.json",
            "songMap": "songMap.json",
            "diagnostics": "diagnostics.json",
        }
        if self.config.preserve_raw_pitch and pitch_raw_path.exists():
            outputs["pitchRaw"] = "pitchRaw.json"
        if self.config.write_quality_report and quality_path.exists():
            outputs["quality"] = "quality.json"
        if vocal_midi.exists() and game_midi.exists():
            outputs.update({"vocalMidi": "vocal.mid", "gameMidi": "game.mid"})

        self._notify(request, "manifest", 98, "Проверка результата")
        integrity: dict[str, dict[str, object]] = {}
        for name, relative in outputs.items():
            artifact = output / relative
            if not artifact.is_file():
                raise FileNotFoundError(f"Manifest artifact is missing: {artifact}")
            integrity[name] = {
                "size": artifact.stat().st_size,
                "sha256": cache.file_hash(artifact),
            }
        manifest = PipelineManifest(
            self.VERSION,
            str(source),
            outputs,
            [to_dict(report) for report in reports],
            warnings,
            title=request.title,
            language=effective_language or request.language,
            integrity=integrity,
        )
        manifest_path = output / "manifest.json"
        write_json_atomic(manifest_path, to_dict(manifest))
        validate_json(manifest_path, ("version", "outputs"))
        self._notify(request, "complete", 100, "Готово")
        return PipelineResult(output, manifest_path, tuple(warnings), tuple(reports))
