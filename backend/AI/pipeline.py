from __future__ import annotations

import math
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
    FALLBACK_WORD_CONFIDENCE,
    LONG_TEXT_ALIGNMENT_VERSION,
    SEGMENTED_ALIGNMENT_VERSION,
    UniformTextFallback,
    _normalize_match_token,
    enforce_segmented_timing_safety,
    resolve_alignment_language,
    tokenize,
)
from .errors import EngineUnavailableError, InvalidArtifactError, ProcessingCancelledError
from .locks import ThreadFileLock
from .lyrics_sources import discover_lyrics
from .models import (
    PipelineManifest,
    PitchFrame,
    StageReport,
    Word,
    to_compact_dict,
    to_dict,
)
from .music import MUSIC_ANALYZER_VERSION, analyze_music
from .notes import build_game_notes, build_vocal_notes
from .pitch_post import (
    PITCH_STABILIZER_VERSION,
    fuse_pitch_with_yin,
    refine_pitch_confidence,
    stabilize_pitch,
)
from .profiler import RuntimeTelemetry
from .syllables import VOWELS, align_syllables
from .utils.env import env_flag
from .utils.io import read_json, write_json_atomic, write_text_atomic
from .utils.numeric import clamp01
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

ProgressCallback = Callable[[str, float, str], None]
CancelCallback = Callable[[], bool]
PIPELINE_LOCK_TIMEOUT_SECONDS = 180.0
CANONICAL_NORMALIZATION_VERSION = "v5-vowel-weighted-interpolation"


def _segments_ignore_real_singing(
    segments: tuple[tuple[float, float, str], ...],
    pitch: list[PitchFrame],
) -> bool:
    if not segments or not pitch: return False
    voiced_times = [frame.time for frame in pitch if frame.voiced]
    if not voiced_times: return False
    ordered = sorted(segments, key=lambda item: item[0])

    def covered(time: float) -> bool: return any((start <= time <= end for start, end, _text in ordered))

    uncovered = sum(1 for time in voiced_times if not covered(time))
    return (uncovered / len(voiced_times)) > 0.35


def _bound_word_durations(words: list[Word]) -> list[Word]:
    bounded: list[Word] = []
    for word in words:
        token_length = max(1, len(word.text.strip()))
        maximum = min(3.2, max(0.7, 0.42 + token_length * 0.22))
        end = min(word.end, word.start + maximum)
        bounded.append(
            Word(word.start, max(word.start + 0.02, end),
                 word.text, word.confidence, word.index)
        )
    return bounded


def _canonical_alignment_matches(text: str, words: list[Word]) -> bool:
    expected = tokenize(text)
    return False if len(expected) != len(words) else all((_normalize_match_token(token) == _normalize_match_token(word.text) for token, word in zip(expected, words, strict=True)))


def _canonical_timeline_is_publishable(words: list[Word], total_duration: float) -> bool:
    if not words: return False
    previous_end = -1.0
    for word in words:
        start = float(word.start)
        end = float(word.end)
        if not math.isfinite(start) or not math.isfinite(end): return False
        if start < -1e-6 or end <= start + 0.009 or end > total_duration + 0.10: return False
        if start < previous_end - 1e-4: return False
        previous_end = end
    return True


def _preserve_complete_canonical_timeline(
    words: list[Word],
    total_duration: float,
    sources: list[str] | None = None,
    candidates: list[dict[str, object]] | None = None,
) -> list[Word] | None:
    if not words or total_duration <= 0.04: return None

    if sources and candidates and len(sources) == len(words) and len(candidates) == len(words):
        local = list(words)
        acoustic = {"ctc", "consensus", "qwen"}
        direct_confidences = [
            clamp01(float(word.confidence))
            for word, source in zip(words, sources, strict=True)
            if source in acoustic
        ]
        durations = sorted(
            float(word.end) - float(word.start)
            for word in words
            if math.isfinite(float(word.start))
            and math.isfinite(float(word.end))
            and float(word.end) > float(word.start)
        )
        typical_duration = durations[len(
            durations) // 2] if durations else 0.25

        def percentile(values: list[float], fraction: float) -> float:
            ordered = sorted(values)
            return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))]

        global_reference = percentile(
            direct_confidences, 0.75) if direct_confidences else 1.0

        def reliability(index: int) -> float:
            word, source = words[index], sources[index]
            if source not in acoustic: return 0.0
            span = float(word.end) - float(word.start)
            if not (
                math.isfinite(float(word.start))
                and math.isfinite(float(word.end))
                and 0.0 <= word.start < word.end <= total_duration
                and span >= max(0.01, typical_duration * 0.10)
                and span <= max(2.5, typical_duration * 6.0)
            ):
                return 0.0
            start, end = max(0, index - 4), min(len(words), index + 5)
            local_confidences = [
                clamp01(float(words[pos].confidence))
                for pos in range(start, end)
                if sources[pos] in acoustic
            ]
            local_reference = (
                percentile(local_confidences,
                           0.75) if local_confidences else global_reference
            )
            evidence_reference = max(
                FALLBACK_WORD_CONFIDENCE,
                min(global_reference, local_reference),
            )
            relative_confidence = min(
                1.0,
                max(0.0, float(word.confidence)) /
                max(1e-9, evidence_reference),
            )
            return 1.0 if source == "consensus" else relative_confidence

        scores = [reliability(index) for index in range(len(words))]
        anchors = {index for index, score in enumerate(
            scores) if score >= 0.25}

        while True:
            changed = False
            ordered = sorted(anchors)
            for left, right in zip([-1, *ordered], [*ordered, len(words)], strict=True):
                left_time = words[left].end if left >= 0 else 0.0
                right_time = words[right].start if right < len(
                    words) else total_duration
                if right_time - left_time + 1e-9 >= (right - left - 1) * 0.01: continue
                removable = [index for index in (
                    left, right) if index in anchors]
                if not removable: return None
                anchors.remove(
                    min(removable, key=lambda index: (scores[index], index)))
                changed = True
                break
            if not changed: break

        def candidate_for(index: int) -> Word | None:
            entry = candidates[index]
            if not isinstance(entry, dict): return None
            options: list[tuple[float, int, Word]] = []
            for rank, kind in enumerate(("ctc", "qwen", "consensus"), start=1):
                value = entry.get(kind)
                if not isinstance(value, dict): continue
                try:
                    start = float(value["start"])
                    end = float(value["end"])
                    confidence = max(
                        0.0, min(1.0, float(value.get("confidence", 0.0))))
                except (KeyError, TypeError, ValueError):
                    continue
                if 0.0 <= start < end <= total_duration and end - start >= 0.01:
                    options.append(
                        (confidence, rank, Word(start, end,
                         words[index].text, confidence, index))
                    )
            if options: return max(options, key=lambda item: item[:2])[2]
            current = words[index]
            return current if sources[index] in {'interpolated', 'reacquired'} and 0.0 <= current.start < current.end <= total_duration and (current.end - current.start >= 0.01) else None

        def interpolate(indices: list[int], start: float, end: float) -> bool:
            if not indices: return True
            if end - start < len(indices) * 0.01: return False
            weights = [
                max(1, len(words[index].text) +
                    2 * sum(char in VOWELS for char in words[index].text))
                for index in indices
            ]
            total_weight, cursor = sum(weights), start
            for index, weight in zip(indices, weights, strict=True):
                boundary = (
                    end if index == indices[-1] else cursor +
                    (end - start) * weight / total_weight
                )
                word = words[index]
                local[index] = Word(cursor, boundary, word.text,
                                    word.confidence, word.index)
                sources[index] = "interpolated"
                cursor = boundary
                total_weight -= weight
                start = cursor
            return True

        def reconstruct(indices: list[int], left_time: float, right_time: float) -> bool:
            cursor = left_time
            pending: list[int] = []
            for index in indices:
                candidate = candidate_for(index)
                if candidate is None or candidate.end > right_time + 1e-9:
                    pending.append(index)
                    continue
                minimum_pending = len(pending) * 0.01
                if candidate.start >= cursor + minimum_pending:
                    if not interpolate(pending, cursor, candidate.start): return False
                    local[index] = candidate
                    if sources[index] not in acoustic and candidate is not words[index]: sources[index] = "reacquired"
                    cursor = candidate.end
                    pending.clear()
                    continue
                block = [*pending, index]
                if candidate.end >= cursor + len(block) * 0.01:
                    if not interpolate(block, cursor, candidate.end): return False
                    if candidate is not words[index]: sources[index] = "reacquired"
                    cursor = candidate.end
                    pending.clear()
                else:
                    pending.append(index)
            return interpolate(pending, cursor, right_time)

        ordered_anchors = sorted(anchors)
        for left, right in zip([-1, *ordered_anchors], [*ordered_anchors, len(words)], strict=True):
            indices = list(range(left + 1, right))
            if not indices: continue
            left_time = local[left].end if left >= 0 else 0.0
            right_time = local[right].start if right < len(
                local) else total_duration
            if not reconstruct(indices, left_time, right_time): return None
        if _canonical_timeline_is_publishable(local, total_duration): return local

    if sources and len(sources) == len(words):
        local = list(words)
        acoustic = {"ctc", "consensus", "qwen"}
        anchors = [index for index, source in enumerate(
            sources) if source in acoustic]
        for left, right in zip([-1, *anchors], [*anchors, len(words)], strict=True):
            indices = list(range(left + 1, right))
            if not indices: continue
            left_time = local[left].end if left >= 0 else 0.0
            right_time = local[right].start if right < len(
                local) else total_duration
            previous_end = left_time
            valid = right_time > left_time
            for index in indices:
                word = local[index]
                valid = (
                    valid
                    and 0.0 <= word.start < word.end <= total_duration
                    and word.start >= previous_end - 1e-4
                    and word.end <= right_time + 1e-4
                )
                previous_end = word.end
            if valid: continue
            weights = [max(1, len(words[index].text)) for index in indices]
            available = right_time - left_time
            if available < len(indices) * 0.01: continue
            cursor = left_time
            total_weight = sum(weights)
            for index, weight in zip(indices, weights, strict=True):
                end = cursor + available * weight / total_weight
                word = words[index]
                local[index] = Word(cursor, end, word.text,
                                    word.confidence, word.index)
                cursor = end
        if _canonical_timeline_is_publishable(local, total_duration): return local

    repaired: list[Word] = []
    for index, word in enumerate(words):
        start = max(0.0, min(total_duration, float(word.start)))
        end = max(start + 0.01, min(total_duration, float(word.end)))
        confidence = clamp01(float(word.confidence))

        if repaired and start < repaired[-1].end:
            previous = repaired[-1]
            boundary = max(previous.start + 0.01, min(end -
                           0.01, (previous.end + start) * 0.5))
            if boundary > previous.start + 0.009 and boundary < end - 0.009:
                repaired[-1] = Word(
                    previous.start, boundary, previous.text, previous.confidence, previous.index
                )
                start = boundary

        if end > total_duration: end = total_duration
        if end <= start + 0.009: end = min(total_duration, start + 0.01)
        repaired.append(Word(start, end, word.text, confidence, index))

    for index in range(len(repaired) - 1, -1, -1):
        word = repaired[index]
        max_end = total_duration if index == len(
            repaired) - 1 else repaired[index + 1].start
        end = min(word.end, max_end)
        if end <= word.start + 0.009:
            start = max(0.0, end - 0.01)
            if index > 0 and start < repaired[index - 1].end: start = repaired[index - 1].end
            if end <= start + 0.009: return None
            repaired[index] = Word(start, end, word.text,
                                   word.confidence, word.index)
    return repaired if _canonical_timeline_is_publishable(repaired, total_duration) else None


def _pipeline_lossless_canonical_words(
    text: str,
    words: list[Word],
    total_duration: float,
    sources: list[str] | None = None,
    candidates: list[dict[str, object]] | None = None,
) -> list[Word]:
    tokens = tokenize(text)
    if not tokens or total_duration <= 0.04: return words

    if _canonical_alignment_matches(text, words):
        preserved = _preserve_complete_canonical_timeline(
            words, total_duration, sources, candidates
        )
        if preserved is None:
            raise InvalidArtifactError(
                "Complete canonical acoustic alignment could not be locally normalized; "
                "refusing to discard CTC/Qwen anchors with global retiming"
            )
        return preserved

    start, end = max(0.0, words[0].start if words else 0.0), total_duration
    if end <= start + 0.08: start, end = 0.0, total_duration

    weights = [
        max(1, len(token) + 2 * sum(char in VOWELS for char in token))
        for token in tokens
    ]
    total, cursor = max(1, sum(weights)), 0
    output: list[Word] = []

    for index, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        word_start = start + (end - start) * cursor / total
        cursor += weight
        word_end = start + (end - start) * cursor / total

        if word_end <= word_start + 0.019: word_end = min(total_duration, word_start + 0.02)

        output.append(Word(word_start, word_end, token, 0.004, index))

    return output


def _lyrics_console(*parts: object) -> None:
    text, stream = ' '.join(str(part) for part in parts), getattr(sys, '__stdout__', None) or sys.stdout
    try:
        if hasattr(stream, "reconfigure") and getattr(stream, "encoding", "").lower() != "utf-8": stream.reconfigure(encoding="utf-8", errors="replace")
        print(text, file=stream, flush=True)
    except (OSError, ValueError, UnicodeError):
        pass


def _lyrics_language_hint(value: str | None) -> str | None:
    text = str(value or "").casefold()
    if any(ch in text for ch in "іїєґ"): return "uk"
    return 'ru' if re.search('[а-яё]', text) else None


def _print_full_lyrics(source: str, text: str, query: str | None) -> None:
    line_count = len([line for line in text.splitlines() if line.strip()])
    _lyrics_console(
        f"[lyrics] result: source={source or 'unknown'} query={query or '<empty>'!r} "
        f"lines={line_count} chars={len(text)}"
    )
    if env_flag("KARAOKE_LYRICS_LOG_TEXT"):
        _lyrics_console("[lyrics] FOUND TEXT BEGIN")
        _lyrics_console(text)
        _lyrics_console("[lyrics] FOUND TEXT END")


class _OutputDirectoryLock(ThreadFileLock):

    def __init__(self, output: Path, timeout_sec: float=30.0): super().__init__(Path(output) / '.pipeline.lock', timeout_sec=timeout_sec)


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
        if (close := getattr(self.engines.separator, "close", None)) is not None: close()

    @staticmethod
    def _remove_stale(*paths: Path) -> None:
        for path in paths:
            with suppress(OSError): path.unlink(missing_ok=True)

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
                {"text": text, "words": [to_compact_dict(word) for word in words]},
                compact=True,
            )
            validate_json(temp_words, ("text", "words"))
            publish_files_atomically(
                [(temp_text, lyrics_txt), (temp_words, words_path)])

    def _cache_hit(
        self, cache: StageCache, stage: str, key: str, outputs: list[Path], validators=None
    ) -> bool:
        if not self.config.validate_cached_artifacts: validators = None
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

    def _restore_optimized_separation_cache(
        self,
        cache: StageCache,
        key: str,
        output: Path,
        vocals: Path,
        instrumental: Path,
    ) -> bool:
        key_matches = getattr(cache, "key_matches", None)
        if key_matches is None or not key_matches("separation", key): return False
        manifest = read_json(output / "manifest.json", {}) or {}
        outputs, integrity = manifest.get('outputs') if isinstance(manifest, dict) else None, manifest.get('integrity') if isinstance(manifest, dict) else None
        if not isinstance(outputs, dict) or not isinstance(integrity, dict): return False
        sources: list[tuple[Path, Path]] = []
        for logical, target in (("vocals", vocals), ("instrumental", instrumental)):
            relative = outputs.get(logical)
            expected = integrity.get(logical)
            if not isinstance(relative, str) or not isinstance(expected, dict): return False
            source = output / relative
            if source.suffix.lower() != ".flac" or not source.is_file(): return False
            if source.stat().st_size != expected.get("size"): return False
            if cache.file_hash(source) != expected.get("sha256"): return False
            sources.append((source, target))
        try:
            with tempfile.TemporaryDirectory(prefix="karaoke-stem-restore-", dir=output) as temp_dir:
                root = Path(temp_dir)
                publications = []
                for source, target in sources:
                    temporary = root / target.name
                    decode_audio(source, temporary, self.config.sample_rate)
                    validate_audio(temporary)
                    publications.append((temporary, target))
                publish_files_atomically(publications)
            cache.commit("separation", key, [vocals, instrumental])
            return True
        except (OSError, RuntimeError, ValueError):
            return False

    def _notify(self, request: PipelineRequest, stage: str, progress: float, message: str):
        if request.cancelled and request.cancelled(): raise ProcessingCancelledError("AI processing was cancelled")
        if request.progress: request.progress(stage, max(0.0, min(100.0, progress)), message)

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
            if not self.config.allow_fallback: raise
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
        with telemetry, audio_buffer_cache(): return self._run_profiled(request, telemetry)

    def _run_profiled(
        self, request: PipelineRequest, telemetry: RuntimeTelemetry
    ) -> PipelineResult:
        source, output = Path(request.source_path).resolve(), Path(request.output_dir).resolve()
        output.mkdir(parents=True, exist_ok=True)
        if not source.is_file(): raise FileNotFoundError(source)
        protected_outputs = {
            (output / "song.wav").resolve(),
            (output / "separated" / "vocals.flac").resolve(),
            (output / "separated" / "instrumental.flac").resolve(),
        }
        if source in protected_outputs:
            raise ValueError(
                "source_path cannot point to a pipeline-generated audio artifact")

        cache = StageCache(output / ".ai-cache")
        reports: list[StageReport] = []
        alignment_debug_raw: dict[str, object] = {}
        warnings: list[str] = []
        source_hash, song_wav, vocals, instrumental = cache.file_hash(source), output / 'song.wav', output / 'separated' / 'vocals.flac', output / 'separated' / 'instrumental.flac'
        vocals.parent.mkdir(exist_ok=True)

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
        supplied_segments: tuple[tuple[float, float, str], ...] = ()
        effective_language, asr_language, lyrics_source, lyrics_query = request.language, request.language or _lyrics_language_hint(request.title), None, request.title
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
            supplied_segments = discovery.segments
            lyrics_source = discovery.source
            lyrics_query = discovery.query or request.title
            if supplied:
                warnings.append(
                    f"Using trusted {lyrics_source} lyrics instead of ASR")

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
            },
        )
        separation_cached = self._cache_hit(
            cache,
            "separation",
            separation_key,
            [vocals, instrumental],
            {vocals: validate_audio, instrumental: validate_audio},
        )
        if not separation_cached:
            separation_cached = self._restore_optimized_separation_cache(
                cache, separation_key, output, vocals, instrumental
            )
        if separation_cached:
            self._report(reports, "separation", "cached", cached=True)
        else:
            with tempfile.TemporaryDirectory(prefix="karaoke-stems-", dir=output) as temp_dir:
                temporary_vocals = Path(temp_dir) / "vocals.wav"
                temporary_instrumental = Path(temp_dir) / "instrumental.wav"
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
                encoded_vocals = Path(temp_dir) / "vocals.flac"
                encoded_instrumental = Path(temp_dir) / "instrumental.flac"
                encode_flac(temporary_vocals, encoded_vocals)
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
        music_path, tempo_key = output / 'music.json', cache.key('tempo', {'instrumental': cache.file_hash(instrumental_fingerprint), 'engine': MUSIC_ANALYZER_VERSION, 'bpm_override': request.bpm_override, 'key_override': request.key_override})
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
            cache, reports, "tempo", tempo_key, [music_path], {music_path: validate_music_json}
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

        primary_melody = getattr(self.engines, "melody", None)
        pitch_key, pitch_outputs = cache.key('pitch', {'vocals': cache.file_hash(vocal_fingerprint), 'primary_engine': getattr(primary_melody, 'name', None), 'primary_config': getattr(primary_melody, 'fingerprint', lambda: {})(), 'primary_postprocess': 'vocal-contour-v1', 'fallback_engine': self.engines.pitch.name, 'fallback_config': getattr(self.engines.pitch, 'fingerprint', lambda: {})(), 'hop': self.config.hop_seconds, 'fmin': self.config.fmin_hz, 'fmax': self.config.fmax_hz, 'postprocessor': PITCH_STABILIZER_VERSION, 'primary_code': cache.optional_file_hash(Path(__file__).parent / 'engines' / 'omnizart_pitch.py'), 'pitch_post_code': cache.optional_file_hash(Path(__file__).with_name('pitch_post.py'))}), [pitch_raw_path, pitch_path] if self.config.preserve_raw_pitch else [pitch_path]
        pitch_validators = {path: validate_pitch_json for path in pitch_outputs}
        if self._cache_hit(cache, "pitch", pitch_key, pitch_outputs, pitch_validators):
            pitch = [PitchFrame(**item) for item in read_json(pitch_path, [])]
            self._report(reports, "pitch", "cached", cached=True)
        else:
            raw_pitch = None
            stabilization_input = None
            if primary_melody is not None:
                started_primary = time.perf_counter()
                try:
                    candidate = primary_melody.estimate(vocals)
                    validate_pitch(candidate)
                    if not any(frame.voiced for frame in candidate):
                        raise EngineUnavailableError(
                            "Omnizart Patch-CNN returned no voiced frames")
                    raw_pitch = list(candidate)
                    stabilization_input = raw_pitch
                    self._report(
                        reports, "pitch-primary", primary_melody.name, started=started_primary
                    )
                except EngineUnavailableError as exc:
                    warnings.append(
                        f"{exc}; using the existing FCPE/YIN fallback")

            if raw_pitch is None:
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

            validate_pitch(raw_pitch)
            pitch = (
                list(raw_pitch)
                if primary_melody is not None and stabilization_input is raw_pitch
                else stabilize_pitch(stabilization_input or raw_pitch)
            )
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

        if _segments_ignore_real_singing(supplied_segments, pitch):
            warnings.append(
                "Synced lyrics timing does not match this audio's vocal activity "
                "(likely a different mix/edit); ignoring its line timestamps and "
                "re-deriving alignment from the audio instead"
            )
            supplied_segments = ()

        lyrics_txt, words_path, text_hash = output / 'lyrics.txt', output / 'lyricsSync.json', StageCache.key('text', {'text': supplied})

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
                    "canonical_normalization": CANONICAL_NORMALIZATION_VERSION,
                    "ctc_models": getattr(
                        getattr(self.engines.aligner,
                                "_ctc", None), "models", {}
                    ),
                    "timed_segments": supplied_segments,
                    "segmented_alignment_algorithm": SEGMENTED_ALIGNMENT_VERSION,
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
                words = _bound_word_durations(
                    [Word(**item) for item in raw.get("words", [])])
                if supplied_segments:
                    cached_text = supplied
                else:
                    words = _pipeline_lossless_canonical_words(
                        supplied, words, song_duration)
                    cached_text = supplied
                self._publish_text_alignment(
                    output, lyrics_txt, words_path, cached_text, words)
                cache.commit("alignment", alignment_key, alignment_outputs)
            else:
                if (
                    not supplied_segments
                    and len(supplied.split()) >= 60
                    and callable(getattr(self.engines.transcriber, "transcribe", None))
                    and callable(getattr(self.engines.aligner, "set_global_asr_segments", None))
                ):
                    started_anchor = time.perf_counter()
                    anchor_segments = []
                    try:
                        if hasattr(self.engines.transcriber, "set_pitch_activity"): self.engines.transcriber.set_pitch_activity(pitch)
                        self.engines.transcriber.transcribe(
                            vocals, effective_language)
                        anchor_segments = list(
                            getattr(self.engines.transcriber,
                                    "last_segments", None) or []
                        )
                    except (EngineUnavailableError, RuntimeError, ValueError) as exc:
                        warnings.append(f"ASR anchor pass unavailable: {exc}")
                    finally:
                        release = getattr(
                            self.engines.transcriber, "release", None)
                        if callable(release): release()
                    self.engines.aligner.set_global_asr_segments(
                        anchor_segments)
                    self._report(
                        reports, "alignment-anchor-asr",
                        f"{self.engines.transcriber.name} segments={len(anchor_segments)}",
                        started=started_anchor,
                    )

                words = self._run(
                    "alignment",
                    self.engines.aligner,
                    lambda engine: (
                        engine.align_segments(
                            vocals, supplied_segments, effective_language)
                        if supplied_segments and callable(getattr(engine, "align_segments", None))
                        else (
                            engine.align_long_text(
                                vocals, supplied, effective_language)
                            if len(supplied.split()) >= 60
                            and callable(getattr(engine, "align_long_text", None))
                            else engine.align(vocals, supplied, effective_language)
                        )
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
                words = _bound_word_durations(words)
                if supplied_segments:
                    words = enforce_segmented_timing_safety(
                        words, supplied_segments, song_duration)
                    publish_text = supplied
                else:
                    word_sources = list(
                        alignment_diagnostics.get("word_sources") or [])
                    word_candidates = list(
                        alignment_diagnostics.get("word_candidates") or [])
                    words = _pipeline_lossless_canonical_words(
                        supplied,
                        words,
                        song_duration,
                        word_sources,
                        word_candidates,
                    )
                    alignment_debug_raw["word_sources"] = word_sources
                    publish_text = supplied
                validate_timeline(words, "words")
                self._publish_text_alignment(
                    output, lyrics_txt, words_path, publish_text, words)
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
                words = _bound_word_durations(
                    [Word(**item)
                     for item in read_json(words_path, {}).get("words", [])]
                )
                self._publish_text_alignment(
                    output, lyrics_txt, words_path, text, words)
                cache.commit("transcription", transcription_key,
                             [lyrics_txt, words_path])
            else:
                if hasattr(self.engines.transcriber, "set_pitch_activity"): self.engines.transcriber.set_pitch_activity(pitch)
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
                words = _bound_word_durations(words)
                validate_timeline(words, "words")
                self._publish_text_alignment(
                    output, lyrics_txt, words_path, text, words)
                cache.commit("transcription", transcription_key,
                             [lyrics_txt, words_path])

            _print_full_lyrics("ASR", text, request.title)

        validate_within_duration(words, song_duration, "words", 0.5)

        self._notify(request, "notes", 82, "Построение нот голоса по vocals.flac")
        notes_path = output / "vocalNotes.json"
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
            activity_segments=supplied_segments,
            fmin_hz=self.config.fmin_hz,
            fmax_hz=self.config.fmax_hz,
        )
        game_notes = build_game_notes(
            vocal_notes, syllables, min_note=self.config.min_note_sec)
        validate_timeline(words, "words")
        validate_timeline(syllables, "syllables")
        validate_timeline(vocal_notes, "vocal notes")
        validate_within_duration(syllables, song_duration, "syllables", 0.5)
        validate_within_duration(vocal_notes, song_duration, "vocal notes", 0.1)
        validate_within_duration(game_notes, song_duration, "game notes", 0.1)
        write_json_atomic(
            notes_path,
            {
                "reference_audio": "separated/vocals.flac",
                "notes": [to_compact_dict(item) for item in game_notes],
            },
            compact=True,
        )
        self._report(reports, "notes", "vocals", started=started)

        lyrics_payload = read_json(words_path, {})
        lyrics_payload.update({
            "reference_audio": "separated/vocals.flac",
            "duration": round(song_duration, 3),
            "bpm": bpm,
            "key": music_analysis.get("key"),
        })
        write_json_atomic(words_path, lyrics_payload, compact=True)

        outputs = {
            "vocals": "separated/vocals.flac",
            "instrumental": "separated/instrumental.flac",
            "lyricsSync": "lyricsSync.json",
            "vocalNotes": "vocalNotes.json",
        }

        self._notify(request, "manifest", 98, "Проверка результата")
        integrity: dict[str, dict[str, object]] = {}
        for name, relative in outputs.items():
            artifact = output / relative
            if not artifact.is_file():
                raise FileNotFoundError(
                    f"Manifest artifact is missing: {artifact}")
            integrity[name] = {
                "size": artifact.stat().st_size,
                "sha256": cache.file_hash(artifact),
            }
        manifest, manifest_path = PipelineManifest(self.VERSION, str(source), outputs, [to_dict(report) for report in reports], warnings, title=request.title, language=effective_language or request.language, integrity=integrity), output / 'manifest.json'
        write_json_atomic(manifest_path, to_dict(manifest))
        validate_json(manifest_path, ("version", "outputs"))
        self._remove_stale(song_wav)
        for name in (
            "music.json", "lyrics.txt", "pitch.json", "pitchRaw.json",
            "syllables.json", "reference.json", "acousticNotes.json",
            "melodyContour.json", "songMap.json", "songInfo.json",
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
        self._notify(request, "complete", 100, "Готово")
        return PipelineResult(output, manifest_path, tuple(warnings), tuple(reports))
