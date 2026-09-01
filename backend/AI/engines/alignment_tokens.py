from __future__ import annotations

import unicodedata

from ..models import Word


def _key(text: str) -> str:
    normalized = unicodedata.normalize("NFKC", text).casefold()
    return "".join(
        char for char in normalized
        if char == "'" or unicodedata.category(char)[:1] in {"L", "N"}
    )


def reconcile_words(words: list[Word], tokens: list[str]) -> list[Word]:
    """Transfer acoustic times when model and lyric token boundaries differ."""
    source = [(word, key) for word in words if (key := _key(word.text))]
    targets = [_key(token) for token in tokens]
    if not source or not targets or any(not token for token in targets):
        return words
    if "".join(key for _, key in source) != "".join(targets):
        return words

    source_ranges, cursor = [], 0
    for word, key in source:
        source_ranges.append((cursor, cursor + len(key), word))
        cursor += len(key)

    def boundary(position: int, *, end: bool) -> float:
        for lower, upper, word in source_ranges:
            contains = lower < position <= upper if end else lower <= position < upper
            if contains:
                ratio = (position - lower) / (upper - lower)
                return word.start + (word.end - word.start) * ratio
        return source_ranges[-1][2].end

    reconciled, lower = [], 0
    for index, (token, key) in enumerate(zip(tokens, targets, strict=True)):
        upper = lower + len(key)
        overlapping = [
            word for start, finish, word in source_ranges
            if start < upper and finish > lower
        ]
        reconciled.append(Word(
            boundary(lower, end=False),
            boundary(upper, end=True),
            token,
            min((word.confidence for word in overlapping), default=0.0),
            index,
        ))
        lower = upper
    return reconciled
