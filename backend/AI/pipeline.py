from __future__ import annotations

import math
import re
import sys
import tempfile
import time
from collections.abc import Callable
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

from .artifacts import publish_files_atomically
from .audio import audio_buffer_cache, decode_audio, duration
from .cache import StageCache
from .config import CoreConfig
from .diagnostics import build_alignment_debug
from .engines.ctc_alignment import CTC_ALIGNMENT_VERSION
from .engines.pitch import PyinFallbackPitchEstimator
from .engines.registry import EngineRegistry
from .engines.separation import CenterChannelFallbackSeparator
from .engines.text import (
    ASR_PIPELINE_VERSION,
    FALLBACK_WORD_CONFIDENCE,
    LONG_TEXT_ALIGNMENT_VERSION,
    UniformTextFallback,
    enforce_segmented_timing_safety,
    resolve_alignment_language,
    tokenize,
)
from .errors import EngineUnavailableError, InvalidArtifactError, ProcessingCancelledError
from .karaoke_timeline import build_karaoke_song_map
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
from .notes import NOTE_DECODER_VERSION, build_game_notes, build_vocal_notes, get_note_diagnostics
from .pitch_post import (
    PITCH_STABILIZER_VERSION,
    fuse_pitch_with_yin,
    refine_pitch_confidence,
    stabilize_pitch,
)
from .profiler import RuntimeTelemetry, environment_info
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
from .version import AI_BUILD_ID
from .vocal_preprocess import (
    VOCAL_ANALYSIS_PREPROCESS_VERSION,
    analyze_vocal_residuals,
    choose_best_pitch_track,
    prepare_midi_analysis_variants,
    score_pitch_track,
)

ProgressCallback = Callable[[str, float, str], None]
CancelCallback = Callable[[], bool]
PIPELINE_LOCK_TIMEOUT_SECONDS = 180.0
CANONICAL_NORMALIZATION_VERSION = "v3-confidence-aware-idempotent-local-anchors"


def _bound_word_durations(words: list[Word]) -> list[Word]:
    """Reject aligner intervals that stretch one token across a long gap."""
    bounded: list[Word] = []
    for word in words:
        token_length = max(1, len(word.text.strip()))
        maximum = min(3.2, max(0.7, 0.42 + token_length * 0.22))
        end = min(word.end, word.start + maximum)
        bounded.append(
            Word(word.start, max(word.start + 0.02, end), word.text, word.confidence, word.index)
        )
    return bounded


def _trim_supplied_text_to_aligned_words(text: str, words: list[Word]) -> str:
    """Keep lyrics.txt text exactly representable by the timed word stream.

    Plain LRCLIB can contain an outro/repetition that does not exist in this
    recording.  If long-text alignment reaches EOF first, publish only complete
    author lines whose tokens have corresponding timed words.
    """
    remaining = len(words)
    if remaining <= 0:
        return ""
    lines = [line.strip() for line in str(text or "").splitlines() if line.strip()]
    if not lines:
        return text.strip()
    kept: list[str] = []
    used = 0
    for line in lines:
        count = len(tokenize(line))
        if count <= 0:
            continue
        if used + count > remaining:
            break
        kept.append(line)
        used += count
        if used == remaining:
            break
    return "\n".join(kept).strip() if kept else text.strip()


def _canonical_alignment_matches(text: str, words: list[Word]) -> bool:
    expected = tokenize(text)
    if len(expected) != len(words):
        return False

    def normalize(value: object) -> str:
        return re.sub(r"[^\w]+", "", str(value).casefold(), flags=re.UNICODE)

    return all(
        normalize(token) == normalize(word.text)
        for token, word in zip(expected, words, strict=True)
    )


def _canonical_timeline_is_publishable(words: list[Word], total_duration: float) -> bool:
    """Return True only for a canonical stream that is safe to publish.

    The v9 guard previously validated token identity/count only. A local Qwen
    window could therefore return the right words from an earlier timestamp,
    producing a backwards jump that survived until validate_timeline().
    """
    if not words:
        return False
    previous_end = -1.0
    for word in words:
        start = float(word.start)
        end = float(word.end)
        if not math.isfinite(start) or not math.isfinite(end):
            return False
        if start < -1e-6 or end <= start + 0.009 or end > total_duration + 0.10:
            return False
        # Karaoke words are a canonical sequence: do not allow a later token to
        # jump behind the previous token. A tiny tolerance is retained for
        # floating-point serialization only.
        if start < previous_end - 1e-4:
            return False
        previous_end = end
    return True


def _repair_canonical_timeline_locally(
    words: list[Word], total_duration: float
) -> list[Word] | None:
    """Repair small Qwen ordering mistakes without sorting/replacing lyrics.

    Words remain in canonical text order. We shift only offending timestamps
    forward and preserve their measured durations. If the repair would cascade
    too far or run past EOF, return None so the whole-song lossless fallback can
    rebuild a safe monotonic map instead of publishing distorted timings.
    """
    if not words or total_duration <= 0.04:
        return None
    repaired: list[Word] = []
    cumulative_shift = 0.0
    max_single_shift = 0.0
    for index, word in enumerate(words):
        original_start = max(0.0, float(word.start))
        duration = max(0.02, min(3.2, float(word.end) - float(word.start)))
        required_start = repaired[-1].end if repaired else original_start
        start = max(original_start, required_start)
        shift = start - original_start
        cumulative_shift += shift
        max_single_shift = max(max_single_shift, shift)
        end = start + duration
        if end > total_duration + 1e-6:
            return None
        repaired.append(Word(start, end, word.text, min(float(word.confidence), 0.25), index))

    # A tiny local overlap/reversal is safe to heal. A multi-second correction
    # means the anchor map itself is wrong; in that case use deterministic
    # whole-song retiming rather than cascading the error through the chorus.
    if max_single_shift > 1.25 or cumulative_shift > max(2.5, len(words) * 0.08):
        return None
    return repaired if _canonical_timeline_is_publishable(repaired, total_duration) else None


def _preserve_complete_canonical_timeline(
    words: list[Word],
    total_duration: float,
    sources: list[str] | None = None,
    candidates: list[dict[str, object]] | None = None,
) -> list[Word] | None:
    """Preserve a complete acoustic alignment and heal only timing defects.

    Once the aligner has returned the full canonical word sequence, pipeline.py
    must never replace all acoustic CTC/Qwen timestamps with a synthetic global
    retiming.  This pass keeps each word confidence/source timing and repairs
    only local overlaps/bounds.
    """
    if not words or total_duration <= 0.04:
        return None

    # A direct acoustic result is a hard boundary only when its evidence is
    # locally reliable.  Near-zero CTC tokens are still useful soft candidates,
    # but must not truncate a neighbouring observation or pull the remainder of
    # the lyric stream.  Source/candidate metadata is optional for old caches.
    if sources and candidates and len(sources) == len(words) and len(candidates) == len(words):
        local = list(words)
        acoustic = {"ctc", "consensus", "qwen"}
        direct_confidences = [
            max(0.0, min(1.0, float(word.confidence)))
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
        typical_duration = durations[len(durations) // 2] if durations else 0.25

        def percentile(values: list[float], fraction: float) -> float:
            ordered = sorted(values)
            return ordered[min(len(ordered) - 1, int((len(ordered) - 1) * fraction))]

        global_reference = percentile(direct_confidences, 0.75) if direct_confidences else 1.0

        def reliability(index: int) -> float:
            word = words[index]
            source = sources[index]
            if source not in acoustic:
                return 0.0
            span = float(word.end) - float(word.start)
            if not (
                math.isfinite(float(word.start))
                and math.isfinite(float(word.end))
                and 0.0 <= word.start < word.end <= total_duration
                and span >= max(0.01, typical_duration * 0.10)
                and span <= max(2.5, typical_duration * 6.0)
            ):
                return 0.0
            start = max(0, index - 4)
            end = min(len(words), index + 5)
            local_confidences = [
                max(0.0, min(1.0, float(words[pos].confidence)))
                for pos in range(start, end)
                if sources[pos] in acoustic
            ]
            local_reference = (
                percentile(local_confidences, 0.75) if local_confidences else global_reference
            )
            evidence_reference = max(
                FALLBACK_WORD_CONFIDENCE,
                min(global_reference, local_reference),
            )
            relative_confidence = min(
                1.0,
                max(0.0, float(word.confidence)) / max(1e-9, evidence_reference),
            )
            # Consensus is independently confirmed. A single-engine anchor
            # must carry a meaningful fraction of the surrounding evidence.
            return 1.0 if source == "consensus" else relative_confidence

        scores = [reliability(index) for index in range(len(words))]
        anchors = {index for index, score in enumerate(scores) if score >= 0.25}

        # Conflicting reliable candidates cannot both be hard boundaries.
        # Demote only the weaker one until every local gap can contain its words.
        while True:
            changed = False
            ordered = sorted(anchors)
            for left, right in zip([-1, *ordered], [*ordered, len(words)], strict=True):
                left_time = words[left].end if left >= 0 else 0.0
                right_time = words[right].start if right < len(words) else total_duration
                if right_time - left_time + 1e-9 >= (right - left - 1) * 0.01:
                    continue
                removable = [index for index in (left, right) if index in anchors]
                if not removable:
                    return None
                anchors.remove(min(removable, key=lambda index: (scores[index], index)))
                changed = True
                break
            if not changed:
                break

        def candidate_for(index: int) -> Word | None:
            entry = candidates[index]
            if not isinstance(entry, dict):
                return None
            options: list[tuple[float, int, Word]] = []
            for rank, kind in enumerate(("ctc", "qwen", "consensus"), start=1):
                value = entry.get(kind)
                if not isinstance(value, dict):
                    continue
                try:
                    start = float(value["start"])
                    end = float(value["end"])
                    confidence = max(0.0, min(1.0, float(value.get("confidence", 0.0))))
                except (KeyError, TypeError, ValueError):
                    continue
                if 0.0 <= start < end <= total_duration and end - start >= 0.01:
                    options.append(
                        (confidence, rank, Word(start, end, words[index].text, confidence, index))
                    )
            if options:
                return max(options, key=lambda item: item[:2])[2]
            current = words[index]
            if (
                sources[index] in {"interpolated", "reacquired"}
                and 0.0 <= current.start < current.end <= total_duration
                and current.end - current.start >= 0.01
            ):
                return current
            return None

        def interpolate(indices: list[int], start: float, end: float) -> bool:
            if not indices:
                return True
            if end - start < len(indices) * 0.01:
                return False
            weights = [max(1, len(words[index].text)) for index in indices]
            total_weight = sum(weights)
            cursor = start
            for index, weight in zip(indices, weights, strict=True):
                boundary = (
                    end if index == indices[-1] else cursor + (end - start) * weight / total_weight
                )
                word = words[index]
                local[index] = Word(cursor, boundary, word.text, word.confidence, word.index)
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
                    if not interpolate(pending, cursor, candidate.start):
                        return False
                    local[index] = candidate
                    if sources[index] not in acoustic and candidate is not words[index]:
                        sources[index] = "reacquired"
                    cursor = candidate.end
                    pending.clear()
                    continue
                block = [*pending, index]
                if candidate.end >= cursor + len(block) * 0.01:
                    if not interpolate(block, cursor, candidate.end):
                        return False
                    if candidate is not words[index]:
                        sources[index] = "reacquired"
                    cursor = candidate.end
                    pending.clear()
                else:
                    pending.append(index)
            return interpolate(pending, cursor, right_time)

        ordered_anchors = sorted(anchors)
        for left, right in zip([-1, *ordered_anchors], [*ordered_anchors, len(words)], strict=True):
            indices = list(range(left + 1, right))
            if not indices:
                continue
            left_time = local[left].end if left >= 0 else 0.0
            right_time = local[right].start if right < len(local) else total_duration
            if not reconstruct(indices, left_time, right_time):
                return None
        if _canonical_timeline_is_publishable(local, total_duration):
            return local

    # Older cached timelines have no candidate evidence. Retain the previous
    # source-aware local repair rather than inventing reliability metadata.
    if sources and len(sources) == len(words):
        local = list(words)
        acoustic = {"ctc", "consensus", "qwen"}
        anchors = [index for index, source in enumerate(sources) if source in acoustic]
        for left, right in zip([-1, *anchors], [*anchors, len(words)], strict=True):
            indices = list(range(left + 1, right))
            if not indices:
                continue
            left_time = local[left].end if left >= 0 else 0.0
            right_time = local[right].start if right < len(local) else total_duration
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
            if valid:
                continue
            weights = [max(1, len(words[index].text)) for index in indices]
            available = right_time - left_time
            if available < len(indices) * 0.01:
                continue
            cursor = left_time
            total_weight = sum(weights)
            for index, weight in zip(indices, weights, strict=True):
                end = cursor + available * weight / total_weight
                word = words[index]
                local[index] = Word(cursor, end, word.text, word.confidence, word.index)
                cursor = end
        if _canonical_timeline_is_publishable(local, total_duration):
            return local

    repaired: list[Word] = []
    for index, word in enumerate(words):
        start = max(0.0, min(total_duration, float(word.start)))
        end = max(start + 0.01, min(total_duration, float(word.end)))
        confidence = max(0.0, min(1.0, float(word.confidence)))

        if repaired and start < repaired[-1].end:
            previous = repaired[-1]
            # Prefer splitting the overlap at its midpoint.  This moves both
            # boundaries by the minimum amount and preserves acoustic anchors
            # far better than shifting the whole remainder of the song.
            boundary = max(previous.start + 0.01, min(end - 0.01, (previous.end + start) * 0.5))
            if boundary > previous.start + 0.009 and boundary < end - 0.009:
                repaired[-1] = Word(
                    previous.start, boundary, previous.text, previous.confidence, previous.index
                )
                start = boundary

        if end > total_duration:
            end = total_duration
        if end <= start + 0.009:
            # A pathological final overlap is repaired with a tiny local window.
            # If even that cannot fit, a backwards normalization below handles it.
            end = min(total_duration, start + 0.01)
        repaired.append(Word(start, end, word.text, confidence, index))

    # If the very end was compressed against EOF, make a small backwards pass
    # over only the affected suffix. Confidence and canonical identity remain
    # untouched.
    for index in range(len(repaired) - 1, -1, -1):
        word = repaired[index]
        max_end = total_duration if index == len(repaired) - 1 else repaired[index + 1].start
        end = min(word.end, max_end)
        if end <= word.start + 0.009:
            start = max(0.0, end - 0.01)
            if index > 0 and start < repaired[index - 1].end:
                start = repaired[index - 1].end
            if end <= start + 0.009:
                return None
            repaired[index] = Word(start, end, word.text, word.confidence, word.index)
    return repaired if _canonical_timeline_is_publishable(repaired, total_duration) else None


def _pipeline_lossless_canonical_words(
    text: str,
    words: list[Word],
    total_duration: float,
    sources: list[str] | None = None,
    candidates: list[dict[str, object]] | None = None,
) -> list[Word]:
    """Final invariant guard before publishing lyricsSync.json.

    A complete canonical alignment is authoritative: preserve its acoustic
    timestamps/confidences and repair only local timeline defects. Synthetic
    whole-song retiming is reserved exclusively for an actually incomplete or
    text-mismatched aligner result.
    """
    tokens = tokenize(text)
    if not tokens or total_duration <= 0.04:
        return words

    canonical_match = _canonical_alignment_matches(text, words)
    if canonical_match:
        preserved = _preserve_complete_canonical_timeline(
            words, total_duration, sources, candidates
        )
        if preserved is None:
            raise InvalidArtifactError(
                "Complete canonical acoustic alignment could not be locally normalized; "
                "refusing to discard CTC/Qwen anchors with global retiming"
            )
        return preserved

    # Only an incomplete/text-mismatched stream may use deterministic emergency
    # retiming. This keeps the lossless invariant while making it impossible for
    # pipeline.py to erase a valid CTC/Qwen merge.
    start = max(0.0, words[0].start if words else 0.0)
    end = total_duration
    if end <= start + 0.08:
        start, end = 0.0, total_duration
    weights = [max(1, len(token)) for token in tokens]
    total = max(1, sum(weights))
    cursor = 0
    output: list[Word] = []
    for index, (token, weight) in enumerate(zip(tokens, weights, strict=True)):
        word_start = start + (end - start) * cursor / total
        cursor += weight
        word_end = start + (end - start) * cursor / total
        if word_end <= word_start + 0.019:
            word_end = min(total_duration, word_start + 0.02)
        output.append(Word(word_start, word_end, token, 0.004, index))
    return output


def _lyrics_console(*parts: object) -> None:
    """Write UTF-8 lyrics diagnostics to the real console, bypassing capture."""
    text = " ".join(str(part) for part in parts)
    stream = getattr(sys, "__stdout__", None) or sys.stdout
    try:
        # Electron/concurrently expects UTF-8 from the backend process on Windows.
        # Reconfigure once so Cyrillic is not emitted using a legacy code page.
        if hasattr(stream, "reconfigure") and getattr(stream, "encoding", "").lower() != "utf-8":
            stream.reconfigure(encoding="utf-8", errors="replace")
        print(text, file=stream, flush=True)
    except (OSError, ValueError, UnicodeError):
        pass


def _lyrics_language_hint(value: str | None) -> str | None:
    """Infer a safe ASR hint from the known song identity.

    A Cyrillic title is much stronger evidence than Qwen's first sung chunk,
    which can otherwise lock onto English and hallucinate an unrelated song.
    """
    text = str(value or "").casefold()
    if any(ch in text for ch in "іїєґ"):
        return "uk"
    if re.search(r"[а-яё]", text):
        return "ru"
    return None


def _print_full_lyrics(source: str, text: str, query: str | None) -> None:
    _lyrics_console(f"[lyrics] search query: {query or '<empty>'}")
    _lyrics_console(f"[lyrics] source: {source or 'unknown'}")
    line_count = len([line for line in text.splitlines() if line.strip()])
    _lyrics_console(f"[lyrics] text received: {line_count} non-empty lines, {len(text)} characters")


class _OutputDirectoryLock(ThreadFileLock):
    """Backward-compatible wrapper around the hardened v2 lock."""

    def __init__(self, output: Path, timeout_sec: float = 30.0):
        super().__init__(Path(output) / ".pipeline.lock", timeout_sec=timeout_sec)


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
        close = getattr(self.engines.separator, "close", None)
        if close is not None:
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
        telemetry = RuntimeTelemetry()
        with telemetry, audio_buffer_cache():
            return self._run_profiled(request, telemetry)

    def _run_profiled(
        self, request: PipelineRequest, telemetry: RuntimeTelemetry
    ) -> PipelineResult:
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
        alignment_debug_raw: dict[str, object] = {}
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

        # Resolve title-based lyrics BEFORE expensive source separation so the
        # operator can immediately verify that we found the correct song text.
        supplied = ""
        supplied_segments: tuple[tuple[float, float, str], ...] = ()
        effective_language = request.language
        asr_language = request.language or _lyrics_language_hint(request.title)
        lyrics_source = None
        lyrics_query = request.title
        if request.lyrics_path and Path(request.lyrics_path).exists():
            supplied = Path(request.lyrics_path).read_text(encoding="utf-8-sig").strip()
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
                warnings.append(f"Using trusted {lyrics_source} lyrics instead of ASR")

        if supplied:
            _print_full_lyrics(lyrics_source or "unknown", supplied, lyrics_query)
        else:
            from .lyrics_sources import _metadata_search_candidates

            attempts = _metadata_search_candidates(source, request.title)
            for index, query in enumerate(attempts, 1):
                _lyrics_console(f"[lyrics] search #{index}: {query}")
                _lyrics_console(f"[lyrics] search #{index}: NOT FOUND")
            _lyrics_console("[lyrics] all title searches failed -> ASR fallback")
            if asr_language:
                _lyrics_console(f"[lyrics] ASR language forced: {asr_language}")

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
                    (Path(getattr(self.engines.separator, "engine_dir", "")) / "inference.py")
                    if getattr(self.engines.separator, "engine_dir", None)
                    else None
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
                # Never trust loose vocals.flac/.mp3 sidecars as a separation cache.
                # They carry no provenance and may belong to an older source song or
                # separator configuration. StageCache already provides a content-
                # addressed cache for the canonical WAV stems.
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

        # All downstream stages must fingerprint the exact files they consume.
        # Using an optional sidecar here can make cache identity diverge from the
        # actual vocals.wav/instrumental.wav passed to pitch/alignment/music.
        vocal_fingerprint = vocals
        instrumental_fingerprint = instrumental

        self._notify(request, "tempo", 48, "Анализ темпа")
        music_path = output / "music.json"
        tempo_key = cache.key(
            "tempo",
            {
                "instrumental": cache.file_hash(instrumental_fingerprint),
                "engine": MUSIC_ANALYZER_VERSION,
                "bpm_override": request.bpm_override,
                "key_override": request.key_override,
            },
        )
        if request.bpm_override is not None:
            override_bpm = float(request.bpm_override)
            if not 20.0 <= override_bpm <= 300.0:
                raise ValueError(f"bpm_override must be between 20 and 300, got {override_bpm}")
        else:
            override_bpm = None
        override_key = str(request.key_override).strip() if request.key_override is not None else ""

        if self._cache_hit(
            cache, "tempo", tempo_key, [music_path], {music_path: validate_music_json}
        ):
            music_analysis = read_json(music_path, {})
            bpm = int(round(float(music_analysis.get("bpm") or 120.0)))
            reports.append(StageReport("tempo", 0, True, "cached"))
        else:
            started = time.perf_counter()
            # If both authoritative values are supplied, do not spend time
            # estimating them only to overwrite the result afterwards.
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
            cache.commit("tempo", tempo_key, [music_path])
            reports.append(
                StageReport(
                    "tempo",
                    time.perf_counter() - started,
                    False,
                    "override" if override_bpm is not None or override_key else "librosa-beat",
                )
            )

        self._notify(request, "pitch", 52, "Очистка вокала и определение мелодии")
        pitch_raw_path = output / "pitchRaw.json"
        pitch_path = output / "pitch.json"
        midi_analysis_vocal = output / "separated" / "vocals.midi-analysis.wav"
        midi_tail_vocal = output / "separated" / "vocals.midi-analysis-tail.wav"
        cleanup_outputs = [midi_analysis_vocal, midi_tail_vocal]
        cleanup_key = cache.key(
            "midi-vocal-cleanup",
            {
                "vocals": cache.file_hash(vocal_fingerprint),
                "algorithm": VOCAL_ANALYSIS_PREPROCESS_VERSION,
                "code": cache.optional_file_hash(Path(__file__).with_name("vocal_preprocess.py")),
            },
        )
        if not self._cache_hit(
            cache,
            "midi-vocal-cleanup",
            cleanup_key,
            cleanup_outputs,
            {path: validate_audio for path in cleanup_outputs},
        ):
            started_cleanup = time.perf_counter()
            prepare_midi_analysis_variants(vocals, midi_analysis_vocal, midi_tail_vocal)
            for path in cleanup_outputs:
                validate_audio(path)
            cache.commit("midi-vocal-cleanup", cleanup_key, cleanup_outputs)
            reports.append(
                StageReport(
                    "midi-vocal-cleanup",
                    time.perf_counter() - started_cleanup,
                    False,
                    VOCAL_ANALYSIS_PREPROCESS_VERSION,
                )
            )
        else:
            reports.append(StageReport("midi-vocal-cleanup", 0, True, "cached"))

        primary_melody = getattr(self.engines, "melody", None)
        pitch_key = cache.key(
            "pitch",
            {
                "song": cache.file_hash(song_wav),
                "vocals": cache.file_hash(vocal_fingerprint),
                "cleanup": VOCAL_ANALYSIS_PREPROCESS_VERSION,
                "primary_engine": getattr(primary_melody, "name", None),
                "primary_config": getattr(primary_melody, "fingerprint", lambda: {})(),
                "primary_postprocess": "native-contour-v1",
                "fallback_engine": self.engines.pitch.name,
                "fallback_config": getattr(self.engines.pitch, "fingerprint", lambda: {})(),
                "hop": self.config.hop_seconds,
                "fmin": self.config.fmin_hz,
                "fmax": self.config.fmax_hz,
                "postprocessor": PITCH_STABILIZER_VERSION,
                "primary_code": cache.optional_file_hash(
                    Path(__file__).parent / "engines" / "omnizart_pitch.py"
                ),
                "pitch_post_code": cache.optional_file_hash(
                    Path(__file__).with_name("pitch_post.py")
                ),
            },
        )
        pitch_outputs = (
            [pitch_raw_path, pitch_path] if self.config.preserve_raw_pitch else [pitch_path]
        )
        pitch_validators = {path: validate_pitch_json for path in pitch_outputs}
        pitch_analysis_source = "cached"
        original_quality = None
        cleaned_quality = None
        tail_quality = None
        if self._cache_hit(cache, "pitch", pitch_key, pitch_outputs, pitch_validators):
            pitch = [PitchFrame(**item) for item in read_json(pitch_path, [])]
            reports.append(StageReport("pitch", 0, True, "cached"))
        else:
            raw_pitch = None
            stabilization_input = None
            if primary_melody is not None:
                started_primary = time.perf_counter()
                try:
                    candidate = primary_melody.estimate(song_wav)
                    validate_pitch(candidate)
                    if not any(frame.voiced for frame in candidate):
                        raise EngineUnavailableError("Omnizart Patch-CNN returned no voiced frames")
                    raw_pitch = list(candidate)
                    stabilization_input = raw_pitch
                    pitch_analysis_source = "omnizart-full-mix"
                    reports.append(
                        StageReport(
                            "pitch-primary",
                            time.perf_counter() - started_primary,
                            False,
                            primary_melody.name,
                        )
                    )
                except EngineUnavailableError as exc:
                    warnings.append(f"{exc}; using the existing FCPE/YIN fallback")

            if raw_pitch is None:
                pitch_candidates = {
                    "original": self._run(
                        "pitch-original",
                        self.engines.pitch,
                        lambda engine: engine.estimate(vocals),
                        reports,
                        warnings,
                    ),
                    "denoise": self._run(
                        "pitch-denoise",
                        self.engines.pitch,
                        lambda engine: engine.estimate(midi_analysis_vocal),
                        reports,
                        warnings,
                    ),
                    "tail-suppressed": self._run(
                        "pitch-tail-suppressed",
                        self.engines.pitch,
                        lambda engine: engine.estimate(midi_tail_vocal),
                        reports,
                        warnings,
                    ),
                }
                for candidate in pitch_candidates.values():
                    validate_pitch(candidate)
                qualities = {
                    name: score_pitch_track(list(value)) for name, value in pitch_candidates.items()
                }
                original_quality = qualities["original"]
                cleaned_quality = qualities["denoise"]
                tail_quality = qualities["tail-suppressed"]
                pitch_analysis_source = choose_best_pitch_track(qualities)
                pitch_audio_by_source = {
                    "original": vocals,
                    "denoise": midi_analysis_vocal,
                    "tail-suppressed": midi_tail_vocal,
                }
                pitch_analysis_audio = pitch_audio_by_source[pitch_analysis_source]
                raw_pitch = list(pitch_candidates[pitch_analysis_source])
                reports.append(
                    StageReport(
                        "pitch-source-selection",
                        0.0,
                        False,
                        " ".join(
                            f"{name}={quality.score:.4f}" for name, quality in qualities.items()
                        )
                        + f" selected={pitch_analysis_source}",
                    )
                )
                confidence_pitch = refine_pitch_confidence(
                    raw_pitch, pitch_analysis_audio, sample_rate=self.config.pitch_sample_rate
                )
                validate_pitch(confidence_pitch)
                stabilization_input = fuse_pitch_with_yin(
                    confidence_pitch,
                    pitch_analysis_audio,
                    sample_rate=self.config.pitch_sample_rate,
                    fmin_hz=self.config.fmin_hz,
                    fmax_hz=self.config.fmax_hz,
                )
                validate_pitch(stabilization_input)

            validate_pitch(raw_pitch)
            # Patch-CNN is already a predominant-vocal contour model. The old
            # harmonic continuity decoder was designed for FCPE/YIN candidates
            # and can rewrite valid Patch-CNN notes by an octave or flatten them
            # back onto the dominant accompaniment line. Preserve its native
            # contour; the acoustic note decoder still performs segmentation.
            pitch = (
                list(raw_pitch)
                if pitch_analysis_source == "omnizart-full-mix"
                else stabilize_pitch(stabilization_input or raw_pitch)
            )
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
                    "ctc_alignment_algorithm": CTC_ALIGNMENT_VERSION,
                    "canonical_normalization": CANONICAL_NORMALIZATION_VERSION,
                    "ctc_models": getattr(
                        getattr(self.engines.aligner, "_ctc", None), "models", {}
                    ),
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
                words = _bound_word_durations([Word(**item) for item in raw.get("words", [])])
                if supplied_segments:
                    cached_text = supplied
                else:
                    words = _pipeline_lossless_canonical_words(supplied, words, song_duration)
                    cached_text = supplied
                self._publish_text_alignment(output, lyrics_txt, words_path, cached_text, words)
                cache.commit("alignment", alignment_key, alignment_outputs)
                reports.append(StageReport("alignment", 0, True, "cached"))
            else:
                # For long plain lyrics, first run an independent ASR navigation
                # pass. Its recognized text is NOT published and cannot replace
                # the trusted lyrics; only coarse time windows are transferred
                # to the forced aligner. This prevents a single long-text Qwen
                # call from losing its place around repeated choruses.
                if (
                    not supplied_segments
                    and len(supplied.split()) >= 60
                    and callable(getattr(self.engines.transcriber, "transcribe", None))
                    and callable(getattr(self.engines.aligner, "set_global_asr_segments", None))
                ):
                    started_anchor = time.perf_counter()
                    anchor_segments = []
                    try:
                        if hasattr(self.engines.transcriber, "set_pitch_activity"):
                            self.engines.transcriber.set_pitch_activity(pitch)
                        self.engines.transcriber.transcribe(vocals, effective_language)
                        anchor_segments = list(
                            getattr(self.engines.transcriber, "last_segments", None) or []
                        )
                    except (EngineUnavailableError, RuntimeError, ValueError) as exc:
                        warnings.append(f"ASR anchor pass unavailable: {exc}")
                    finally:
                        release = getattr(self.engines.transcriber, "release", None)
                        if callable(release):
                            release()
                    self.engines.aligner.set_global_asr_segments(anchor_segments)
                    reports.append(
                        StageReport(
                            "alignment-anchor-asr",
                            time.perf_counter() - started_anchor,
                            False,
                            f"{self.engines.transcriber.name} segments={len(anchor_segments)}",
                        )
                    )

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
                alignment_diagnostics = (
                    getattr(self.engines.aligner, "last_alignment_diagnostics", None) or {}
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
                    reports.append(StageReport("alignment-acoustic", 0.0, False, details))
                words = _bound_word_durations(words)
                if supplied_segments:
                    words = enforce_segmented_timing_safety(words, supplied_segments, song_duration)
                    publish_text = supplied
                else:
                    # Canonical lyrics are lossless. ASR/forced alignment may
                    # estimate timing, but may never delete or replace words.
                    word_sources = list(alignment_diagnostics.get("word_sources") or [])
                    word_candidates = list(alignment_diagnostics.get("word_candidates") or [])
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
                self._publish_text_alignment(output, lyrics_txt, words_path, publish_text, words)
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
                    [Word(**item) for item in read_json(words_path, {}).get("words", [])]
                )
                self._publish_text_alignment(output, lyrics_txt, words_path, text, words)
                cache.commit("transcription", transcription_key, [lyrics_txt, words_path])
                reports.append(StageReport("transcription", 0, True, "cached"))
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
                words = _bound_word_durations(words)
                validate_timeline(words, "words")
                self._publish_text_alignment(output, lyrics_txt, words_path, text, words)
                cache.commit("transcription", transcription_key, [lyrics_txt, words_path])

            _print_full_lyrics("ASR", text, request.title)

        validate_within_duration(words, song_duration, "words", 0.5)

        self._notify(request, "syllables", 82, "Разметка слогов и нот")
        syllable_path = output / "syllables.json"
        reference = output / "reference.json"
        contour = output / "melodyContour.json"
        notes_path = output / "acousticNotes.json"
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
                "decoder_code": cache.optional_file_hash(Path(__file__).with_name("notes.py")),
                "pipeline_code": cache.optional_file_hash(Path(__file__)),
                "build": AI_BUILD_ID,
                "syllable_aligner": SYLLABLE_ALIGNER_VERSION,
                "trusted_activity_segments": supplied_segments,
            },
        )
        note_diagnostics: dict[str, object] = {}
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
                words=words,
                # Register verification must use the tail-suppressed analysis
                # copy; using the wet separated stem here reintroduced echo and
                # reverb harmonics after the cleaned pitch track was selected.
                audio=midi_tail_vocal,
                activity_segments=supplied_segments,
                fmin_hz=self.config.fmin_hz,
                fmax_hz=self.config.fmax_hz,
            )
            note_diagnostics = get_note_diagnostics()
            game_notes = build_game_notes(vocal_notes, syllables, min_note=self.config.min_note_sec)
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

        # Always read the canonical lyrics that were actually published by the
        # alignment/transcription stage. The local variable ``text`` is only
        # assigned in the transcription branch, so using it here made the
        # supplied-lyrics branch fail after MIDI generation.
        canonical_lyrics_text = (
            lyrics_txt.read_text(encoding="utf-8") if lyrics_txt.exists() else str(supplied or "")
        )

        song_map = output / "songMap.json"
        song_map_key = cache.key(
            "song-map",
            {
                "derivation": derivation_key,
                "duration": song_duration,
                "bpm": round(bpm, 6),
                "key": music_analysis.get("key"),
                "tempo": tempo_key,
                "build": AI_BUILD_ID,
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
                build_karaoke_song_map(
                    lyrics_text=canonical_lyrics_text,
                    words=words,
                    syllables=syllables,
                    game_notes=game_notes,
                    duration=song_duration,
                    bpm=bpm,
                    key=music_analysis.get("key"),
                    ai_build_id=AI_BUILD_ID,
                    note_decoder_version=NOTE_DECODER_VERSION,
                ),
            )
            cache.commit("song-map", song_map_key, [song_map])
            # A fresh AI SongMap becomes the new editable baseline. Never keep
            # a manual-editor backup from an older processing run.
            self._remove_stale(output / "songMap.ai.json")
            reports.append(StageReport("song-map", 0.0, False, "builder"))

        quality_path = output / "quality.json"
        quality = evaluate_quality(song_duration, pitch, words, syllables, vocal_notes)
        if self.config.write_quality_report:
            write_json_atomic(quality_path, to_dict(quality))
        else:
            self._remove_stale(quality_path)
        warnings.extend(item for item in quality.warnings if item not in warnings)
        alignment_debug_path = output / "alignmentDebug.json"
        raw_pitch_for_debug = (
            [PitchFrame(**item) for item in read_json(pitch_raw_path, [])]
            if pitch_raw_path.exists()
            else None
        )
        try:
            vocal_effect_diagnostics = analyze_vocal_residuals(
                vocals, instrumental, midi_analysis_vocal, midi_tail_vocal
            )
        except (OSError, RuntimeError, ValueError) as exc:
            vocal_effect_diagnostics = {"available": False, "reason": str(exc)}
            warnings.append(f"Vocal residual diagnostics unavailable: {exc}")
        alignment_debug = build_alignment_debug(
            lyrics_text=lyrics_txt.read_text(encoding="utf-8") if lyrics_txt.exists() else "",
            words=words,
            syllables=syllables,
            pitch=pitch,
            notes=vocal_notes,
            duration_sec=song_duration,
            raw_pitch=raw_pitch_for_debug,
            game_notes=game_notes,
            alignment_diagnostics={
                **dict(alignment_debug_raw.get("model_evidence") or {}),
                "word_sources": list(alignment_debug_raw.get("word_sources") or []),
                "word_candidates": list(alignment_debug_raw.get("word_candidates") or []),
            },
            reports=reports,
            note_diagnostics=note_diagnostics,
            music_diagnostics=music_analysis,
            pitch_source_diagnostics={
                "selected": pitch_analysis_source,
                "original": to_dict(original_quality) if original_quality is not None else None,
                "denoise": to_dict(cleaned_quality) if cleaned_quality is not None else None,
                "tail_suppressed": to_dict(tail_quality) if tail_quality is not None else None,
            },
            vocal_effect_diagnostics=vocal_effect_diagnostics,
        )
        write_json_atomic(alignment_debug_path, alignment_debug)

        runtime_performance = telemetry.result(reports)
        performance_path = output / "performance.json"
        write_json_atomic(performance_path, runtime_performance)
        diagnostics_path = output / "diagnostics.json"
        write_json_atomic(
            diagnostics_path,
            {
                "build": {
                    "ai_build_id": AI_BUILD_ID,
                    "pipeline_version": self.VERSION,
                    "note_decoder_version": NOTE_DECODER_VERSION,
                    "pitch_stabilizer_version": PITCH_STABILIZER_VERSION,
                    "pipeline_file": str(Path(__file__).resolve()),
                },
                "environment": environment_info(),
                "quality": to_dict(quality),
                "health": alignment_debug.get("health", {}),
                "alignment_summary": alignment_debug.get("summary", {}),
                "alignment_suspicious_regions": alignment_debug.get("suspicious_regions", []),
                "timeline_integrity": alignment_debug.get("timeline_integrity", {}),
                "root_cause_analysis": alignment_debug.get("root_cause_analysis", {}),
                "pitch_source_analysis": alignment_debug.get("pitch_source_analysis", {}),
                "vocal_effect_analysis": alignment_debug.get("vocal_effect_analysis", {}),
                "performance": {
                    **dict(alignment_debug.get("performance", {})),
                    "runtime": runtime_performance,
                },
                "data_flow": {
                    "source_sha256": source_hash,
                    "song_sha256": cache.file_hash(song_wav),
                    "vocals_sha256": cache.file_hash(vocals),
                    "midi_analysis_vocals_sha256": cache.file_hash(midi_analysis_vocal),
                    "midi_analysis_tail_vocals_sha256": cache.file_hash(midi_tail_vocal),
                    "pitch_analysis_source": pitch_analysis_source,
                    "pitch_preprocess_version": VOCAL_ANALYSIS_PREPROCESS_VERSION,
                    "note_analysis": note_diagnostics,
                    "pitch_original_quality": to_dict(original_quality)
                    if original_quality is not None
                    else None,
                    "pitch_cleaned_quality": to_dict(cleaned_quality)
                    if cleaned_quality is not None
                    else None,
                    "instrumental_sha256": cache.file_hash(instrumental),
                    "bpm": bpm,
                    "bpm_source": music_analysis.get("tempo_source", "analysis"),
                    "key": music_analysis.get("key"),
                    "key_source": music_analysis.get("key_source", "analysis"),
                    "pitch_frames": len(pitch),
                    "voiced_pitch_frames": sum(
                        1 for frame in pitch if frame.voiced and frame.frequency > 0
                    ),
                    "words": len(words),
                    "syllables": len(syllables),
                    "vocal_notes": len(vocal_notes),
                    "game_notes": len(game_notes),
                },
                "stages": [to_dict(report) for report in reports],
                "cache_hits": sum(1 for report in reports if report.cached),
                "cache_misses": sum(1 for report in reports if not report.cached),
            },
        )

        outputs = {
            "song": "song.wav",
            "vocals": "separated/vocals.wav",
            "midiAnalysisVocals": "separated/vocals.midi-analysis.wav",
            "instrumental": "separated/instrumental.wav",
            "music": "music.json",
            "lyrics": "lyrics.txt",
            "lyricsSync": "lyricsSync.json",
            "pitch": "pitch.json",
            "syllables": "syllables.json",
            "reference": "reference.json",
            "acousticNotes": "acousticNotes.json",
            "melodyContour": "melodyContour.json",
            "songMap": "songMap.json",
            "diagnostics": "diagnostics.json",
            "alignmentDebug": "alignmentDebug.json",
            "performance": "performance.json",
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
