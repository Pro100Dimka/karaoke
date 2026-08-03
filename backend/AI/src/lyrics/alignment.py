"""Keep displayed lyric words aligned with vocal word timestamps."""

from __future__ import annotations

import math
import re


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
