"""Keep displayed lyric words aligned with vocal word timestamps."""

from __future__ import annotations

import math
import re
from difflib import SequenceMatcher


def _text_tokens(text: str) -> list[str]:
    return re.findall(r"\S+", text.strip())


def _valid_words(words: object) -> list[dict]:
    if not isinstance(words, list):
        return []
    result = []
    for word in words:
        if not isinstance(word, dict):
            continue
        try:
            start, end = float(word["start"]), float(word["end"])
        except (KeyError, TypeError, ValueError):
            continue
        if end >= start:
            result.append(
                {
                    "word": str(word.get("word") or word.get("text") or ""),
                    "start": start,
                    "end": end,
                }
            )
    return sorted(result, key=lambda word: (word["start"], word["end"]))


def reconcile_lyric_words(lines: list[dict]) -> list[dict]:
    """Project corrected visible words onto trusted vocal timing, monotonically."""
    result = []
    for raw_line in lines:
        line = dict(raw_line)
        tokens = _text_tokens(str(line.get("text") or ""))
        timed_words = _valid_words(line.get("words"))
        if not tokens:
            line["words"] = []
            result.append(line)
            continue

        try:
            line_start, line_end = float(line["start"]), float(line["end"])
        except (KeyError, TypeError, ValueError):
            line_start, line_end = 0.0, float(len(tokens))
        if timed_words:
            line_start, line_end = timed_words[0]["start"], timed_words[-1]["end"]
        line_end = max(line_start, line_end)

        count = len(timed_words)
        words = []
        for index, token in enumerate(tokens):
            if count:
                first = min(count - 1, math.floor(index * count / len(tokens)))
                last = min(count - 1, math.ceil((index + 1) * count / len(tokens)) - 1)
                start, end = timed_words[first]["start"], timed_words[last]["end"]
            else:
                start = line_start + (line_end - line_start) * index / len(tokens)
                end = line_start + (line_end - line_start) * (index + 1) / len(tokens)
            words.append(
                {"word": token, "start": round(start, 3), "end": round(max(start, end), 3)}
            )

        line["text"] = " ".join(tokens)
        line["start"] = round(line_start, 3)
        line["end"] = round(line_end, 3)
        line["words"] = words
        result.append(line)
    return result


_TOKEN_RE = re.compile(r"[^\w'’]+", re.UNICODE)


def _normalized_token(text: str) -> str:
    return _TOKEN_RE.sub("", text.casefold().replace("ё", "е")).strip()


def _flatten_timed_words(lines: list[dict]) -> list[dict]:
    words: list[dict] = []
    for line in lines:
        words.extend(_valid_words(line.get("words")))
    return sorted(words, key=lambda item: (item["start"], item["end"]))


def _token_similarity(left: str, right: str) -> float:
    if not left or not right:
        return 0.0
    if left == right:
        return 1.0
    # Whisper often loses one ending or confuses a single Cyrillic character.
    # Treat close words as timing anchors, but avoid anchoring very short words.
    if min(len(left), len(right)) >= 4 and (left.startswith(right) or right.startswith(left)):
        return min(len(left), len(right)) / max(len(left), len(right))
    return SequenceMatcher(None, left, right, autojunk=False).ratio()


def _align_token_indices(target: list[str], source: list[str]) -> dict[int, int]:
    """Monotonic fuzzy alignment of corrected lyrics to recognized words."""
    n, m = len(target), len(source)
    costs = [[0.0] * (m + 1) for _ in range(n + 1)]
    moves = [[""] * (m + 1) for _ in range(n + 1)]
    similarities = [[0.0] * m for _ in range(n)]
    for i in range(1, n + 1):
        costs[i][0], moves[i][0] = float(i), "up"
    for j in range(1, m + 1):
        costs[0][j], moves[0][j] = float(j), "left"
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            similarity = _token_similarity(target[i - 1], source[j - 1])
            similarities[i - 1][j - 1] = similarity
            substitution = 0.0 if similarity == 1.0 else 1.7 - similarity
            candidates = (
                (costs[i - 1][j - 1] + substitution, "diag"),
                (costs[i - 1][j] + 1.0, "up"),
                (costs[i][j - 1] + 1.0, "left"),
            )
            costs[i][j], moves[i][j] = min(candidates, key=lambda item: item[0])
    matches: dict[int, int] = {}
    i, j = n, m
    while i and j:
        move = moves[i][j]
        if move == "diag":
            similarity = similarities[i - 1][j - 1]
            minimum = 0.80 if min(len(target[i - 1]), len(source[j - 1])) >= 4 else 1.0
            if similarity >= minimum:
                matches[i - 1] = j - 1
            i -= 1
            j -= 1
        elif move == "up":
            i -= 1
        else:
            j -= 1
    return matches


def project_lyrics_onto_timing(visible_lines: list[str], timed_lines: list[dict]) -> list[dict]:
    """Keep the supplied lyrics exactly while borrowing Whisper word timing.

    Unlike the old line-count based replacement, this aligns the complete token
    streams. It therefore survives different punctuation and line segmentation.
    """
    line_tokens = [_text_tokens(line) for line in visible_lines]
    target_tokens = [token for tokens in line_tokens for token in tokens]
    timed_words = _flatten_timed_words(timed_lines)
    if not target_tokens or not timed_words:
        return reconcile_lyric_words(
            [{"text": line, "start": 0.0, "end": 0.0, "words": []} for line in visible_lines]
        )

    source_tokens = [str(word.get("word", "")) for word in timed_words]
    matches = _align_token_indices(
        [_normalized_token(token) for token in target_tokens],
        [_normalized_token(token) for token in source_tokens],
    )

    starts = [None] * len(target_tokens)
    ends = [None] * len(target_tokens)
    for target_index, source_index in matches.items():
        starts[target_index] = timed_words[source_index]["start"]
        ends[target_index] = timed_words[source_index]["end"]

    # Fill unmatched words monotonically between trusted anchors. This is much
    # safer than assigning the whole Whisper segment to every visible word.
    anchors = [-1, *sorted(matches), len(target_tokens)]
    audio_start, audio_end = timed_words[0]["start"], timed_words[-1]["end"]
    for left, right in zip(anchors, anchors[1:]):
        gap = right - left - 1
        if gap <= 0:
            continue
        left_time = audio_start if left < 0 else float(ends[left])
        right_time = audio_end if right >= len(target_tokens) else float(starts[right])
        right_time = max(left_time, right_time)
        step = (right_time - left_time) / gap
        for offset, index in enumerate(range(left + 1, right), start=0):
            starts[index] = left_time + step * offset
            ends[index] = left_time + step * (offset + 1)

    result: list[dict] = []
    cursor = 0
    for original_line, tokens in zip(visible_lines, line_tokens, strict=True):
        count = len(tokens)
        chunk = []
        for token, start, end in zip(
            tokens, starts[cursor : cursor + count], ends[cursor : cursor + count], strict=True
        ):
            start_value = float(start if start is not None else audio_start)
            end_value = max(start_value, float(end if end is not None else start_value))
            chunk.append({"word": token, "start": round(start_value, 3), "end": round(end_value, 3)})
        cursor += count
        if chunk:
            result.append(
                {
                    "text": original_line.strip(),
                    "start": chunk[0]["start"],
                    "end": chunk[-1]["end"],
                    "words": chunk,
                }
            )
    return result
