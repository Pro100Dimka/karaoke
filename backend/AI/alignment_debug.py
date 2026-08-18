from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import numpy as np

from .audio import load_mono
from .engines.text import tokenize
from .models import Word
from .utils.env import env_flag

DEBUG_ENV = "KARAOKE_ALIGNMENT_DEBUG"


def alignment_debug_enabled() -> bool:
    return env_flag(DEBUG_ENV)


def _word_dict(word: Word) -> dict[str, Any]:
    return {
        "text": word.text,
        "start": round(float(word.start), 4),
        "end": round(float(word.end), 4),
        "duration": round(max(0.0, float(word.end) - float(word.start)), 4),
        "confidence": round(float(word.confidence), 4),
    }


def _line_min_duration(tokens: list[str]) -> float:
    if not tokens:
        return 0.0
    letters = sum(len(token) for token in tokens)
    return max(0.45, 0.17 * len(tokens) + 0.018 * letters)


def _line_max_duration(tokens: list[str]) -> float:
    if not tokens:
        return 0.0
    # Deliberately generous for singing / held notes. This is diagnostic only.
    letters = sum(len(token) for token in tokens)
    return max(3.0, 1.35 * len(tokens) + 0.045 * letters)


def _rms_activity(
    audio: np.ndarray, sample_rate: int, start: float, end: float
) -> dict[str, float]:
    left = max(0, min(len(audio), int(max(0.0, start) * sample_rate)))
    right = max(left, min(len(audio), int(max(start, end) * sample_rate)))
    chunk = np.asarray(audio[left:right], dtype=np.float32)
    if chunk.size == 0:
        return {"rms": 0.0, "peak": 0.0, "active_ratio": 0.0}

    rms = float(np.sqrt(np.mean(chunk * chunk) + 1e-12))
    peak = float(np.max(np.abs(chunk))) if chunk.size else 0.0

    hop = max(1, int(sample_rate * 0.04))
    frame = max(hop, int(sample_rate * 0.08))
    if chunk.size < frame:
        return {"rms": rms, "peak": peak, "active_ratio": 1.0 if rms > 1e-5 else 0.0}

    values = np.asarray(
        [
            float(np.sqrt(np.mean(chunk[pos : pos + frame] ** 2) + 1e-12))
            for pos in range(0, chunk.size - frame + 1, hop)
        ],
        dtype=np.float32,
    )
    p10 = float(np.percentile(values, 10))
    p90 = float(np.percentile(values, 90))
    threshold = max(p10 * 1.25, p10 + (p90 - p10) * 0.20)
    active_ratio = float(np.mean(values >= threshold))
    return {"rms": rms, "peak": peak, "active_ratio": active_ratio}


def _confidence_mode(words: list[Word]) -> str:
    if not words:
        return "missing"
    values = [float(word.confidence) for word in words]
    mean = sum(values) / len(values)
    # Current fallbacks stamp confidence around 0.05-0.12. This makes the
    # diagnostic explicitly tell us where the forced aligner stopped being used.
    if max(values) <= 0.121:
        return "fallback"
    if mean < 0.20:
        return "very_low_confidence"
    return "forced_aligner"


def build_alignment_debug(
    vocals,
    lyrics_text: str,
    words: list[Word],
) -> dict[str, Any]:
    source_audio, sample_rate = load_mono(vocals, 16000)
    duration_sec = len(source_audio) / sample_rate if sample_rate else 0.0

    lines = [line.strip() for line in str(lyrics_text or "").splitlines() if line.strip()]
    source_tokens = [token for line in lines for token in tokenize(line)]
    aligned_tokens = [word.text for word in words]

    report: dict[str, Any] = {
        "audio_duration_sec": round(duration_sec, 4),
        "source_line_count": len(lines),
        "source_token_count": len(source_tokens),
        "aligned_word_count": len(words),
        "token_count_matches": len(source_tokens) == len(words),
        "first_token_mismatch": None,
        "first_suspect": None,
        "lines": [],
    }

    for index, (source, aligned) in enumerate(zip(source_tokens, aligned_tokens, strict=False)):
        if source.casefold().replace("ё", "е") != aligned.casefold().replace("ё", "е"):
            report["first_token_mismatch"] = {
                "index": index,
                "expected": source,
                "actual": aligned,
            }
            break
    if report["first_token_mismatch"] is None and len(source_tokens) != len(words):
        report["first_token_mismatch"] = {
            "index": min(len(source_tokens), len(words)),
            "expected": source_tokens[len(words)] if len(words) < len(source_tokens) else None,
            "actual": words[len(source_tokens)].text if len(source_tokens) < len(words) else None,
            "reason": "token_count_mismatch",
        }

    word_cursor = 0
    previous_end = 0.0
    for line_index, line in enumerate(lines):
        tokens = tokenize(line)
        count = len(tokens)
        line_words = words[word_cursor : word_cursor + count]
        word_cursor += count

        item: dict[str, Any] = {
            "line_index": line_index,
            "text": line,
            "token_count": count,
            "word_index_start": word_cursor - count,
            "word_index_end": word_cursor - 1 if count else word_cursor,
            "reasons": [],
            "severity": 0,
        }

        if count == 0:
            item["mode"] = "no_tokens"
            report["lines"].append(item)
            continue
        if len(line_words) != count:
            item["mode"] = "missing_words"
            item["reasons"].append(
                f"Expected {count} words from source line, but only {len(line_words)} aligned words remain"
            )
            item["severity"] = 100
            report["lines"].append(item)
            if report["first_suspect"] is None:
                report["first_suspect"] = item.copy()
            continue

        start = float(line_words[0].start)
        end = float(line_words[-1].end)
        span = max(0.0, end - start)
        gap_before = max(0.0, start - previous_end) if line_index else start
        confidences = [float(word.confidence) for word in line_words]
        mean_confidence = sum(confidences) / len(confidences)
        mode = _confidence_mode(line_words)
        minimum = _line_min_duration(tokens)
        maximum = _line_max_duration(tokens)
        activity = _rms_activity(source_audio, sample_rate, start, end)
        before_activity = _rms_activity(
            source_audio, sample_rate, max(previous_end, start - 2.5), start
        )

        item.update(
            {
                "start": round(start, 4),
                "end": round(end, 4),
                "span": round(span, 4),
                "gap_before": round(gap_before, 4),
                "mean_confidence": round(mean_confidence, 4),
                "min_confidence": round(min(confidences), 4),
                "max_confidence": round(max(confidences), 4),
                "mode": mode,
                "expected_min_span": round(minimum, 4),
                "expected_max_span": round(maximum, 4),
                "vocal_activity": {key: round(value, 6) for key, value in activity.items()},
                "activity_before_line": {
                    key: round(value, 6) for key, value in before_activity.items()
                },
                "words": [_word_dict(word) for word in line_words],
            }
        )

        if mode == "fallback":
            item["reasons"].append(
                "Forced aligner was rejected/failed here; published timings came from fallback activity distribution"
            )
            item["severity"] += 45
        elif mode == "very_low_confidence":
            item["reasons"].append("Forced-aligner confidence is extremely low")
            item["severity"] += 30

        if span < minimum * 0.72:
            item["reasons"].append(
                f"Line is compressed: {span:.2f}s for {count} words (diagnostic minimum ~{minimum:.2f}s)"
            )
            item["severity"] += 40
        if span > maximum:
            item["reasons"].append(
                f"Line is stretched: {span:.2f}s for {count} words (generous maximum ~{maximum:.2f}s)"
            )
            item["severity"] += 35

        durations = [max(0.0, float(word.end) - float(word.start)) for word in line_words]
        if durations and max(durations) > 3.2:
            longest_index = int(np.argmax(durations))
            item["reasons"].append(
                f"One word is implausibly long: '{line_words[longest_index].text}' = {durations[longest_index]:.2f}s"
            )
            item["severity"] += 35
        if sum(duration <= 0.09 for duration in durations) > max(1, len(durations) // 3):
            item["reasons"].append("Too many words are <=90ms; likely context collapse")
            item["severity"] += 35

        internal_gaps = [
            max(0.0, float(right.start) - float(left.end))
            for left, right in zip(line_words, line_words[1:], strict=False)
        ]
        if internal_gaps and max(internal_gaps) > 1.6:
            item["reasons"].append(f"Huge gap inside one written line: {max(internal_gaps):.2f}s")
            item["severity"] += 25

        # Strong vocals immediately before a late line are a useful symptom of
        # a phrase that the aligner skipped and then resumed too far to the right.
        if (
            gap_before > 0.8
            and before_activity["rms"] > activity["rms"] * 0.75
            and before_activity["peak"] > 1e-4
        ):
            item["reasons"].append(
                "There is substantial vocal energy in the gap before this line; the line may have been aligned too late"
            )
            item["severity"] += 20

        # A sudden fallback transition is usually the exact place where drift starts.
        if report["lines"]:
            previous_mode = report["lines"][-1].get("mode")
            if previous_mode == "forced_aligner" and mode == "fallback":
                item["reasons"].append(
                    "FIRST forced-aligner -> fallback transition; this is a prime drift origin"
                )
                item["severity"] += 50

        report["lines"].append(item)
        previous_end = max(previous_end, end)

        if report["first_suspect"] is None and item["severity"] >= 45:
            report["first_suspect"] = {
                key: value for key, value in item.items() if key not in {"words"}
            }

    suspicious = sorted(
        (item for item in report["lines"] if item.get("severity", 0) > 0),
        key=lambda item: (-int(item.get("severity", 0)), int(item.get("line_index", 0))),
    )
    report["top_suspects"] = [
        {key: value for key, value in item.items() if key != "words"} for item in suspicious[:12]
    ]
    return report


def write_alignment_debug(
    output_path: Path,
    vocals,
    lyrics_text: str,
    words: list[Word],
) -> dict[str, Any]:
    report = build_alignment_debug(vocals, lyrics_text, words)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(
        json.dumps(report, ensure_ascii=False, indent=2),
        encoding="utf-8",
    )

    suspect = report.get("first_suspect")
    print("\n" + "=" * 78, flush=True)
    print("[ALIGNMENT DEBUG] diagnostic report written to:", output_path, flush=True)
    if suspect:
        print(
            "[ALIGNMENT DEBUG] FIRST SUSPECT:",
            f"line #{int(suspect.get('line_index', 0)) + 1}",
            f"{suspect.get('start', '?')}s -> {suspect.get('end', '?')}s",
            flush=True,
        )
        print("[ALIGNMENT DEBUG] TEXT:", suspect.get("text", ""), flush=True)
        for reason in suspect.get("reasons", []):
            print("[ALIGNMENT DEBUG] WHY:", reason, flush=True)
    else:
        print("[ALIGNMENT DEBUG] No obvious structural timing failure detected.", flush=True)
    print("=" * 78 + "\n", flush=True)
    return report


def _main() -> int:
    import argparse

    parser = argparse.ArgumentParser(
        description="Diagnose the first suspicious karaoke lyric-alignment point"
    )
    parser.add_argument(
        "song_folder",
        help="Processed song folder containing lyrics.txt, lyricsSync.json and separated/vocals.*",
    )
    args = parser.parse_args()

    root = Path(args.song_folder).expanduser().resolve()
    lyrics_path = root / "lyrics.txt"
    sync_path = root / "lyricsSync.json"
    vocals_candidates = [
        root / "separated" / "vocals.flac",
        root / "separated" / "vocals.wav",
        root / "vocals.flac",
        root / "vocals.wav",
    ]
    vocals_path = next((path for path in vocals_candidates if path.exists()), None)

    missing = [str(path) for path in (lyrics_path, sync_path) if not path.exists()]
    if vocals_path is None:
        missing.append("separated/vocals.flac|wav")
    if missing:
        print("[ALIGNMENT DEBUG] Missing required files:", ", ".join(missing))
        return 2

    raw = json.loads(sync_path.read_text(encoding="utf-8"))
    raw_words = raw.get("words", []) if isinstance(raw, dict) else []
    words = [Word(**item) for item in raw_words]
    lyrics = lyrics_path.read_text(encoding="utf-8")
    write_alignment_debug(root / "alignmentDebug.json", vocals_path, lyrics, words)
    return 0


if __name__ == "__main__":  # pragma: no cover - exercised through _main()
    raise SystemExit(_main())
