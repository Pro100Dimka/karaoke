from __future__ import annotations

import copy
import re
from dataclasses import dataclass
from difflib import SequenceMatcher
from typing import Any

from .lyrics_document import validate_lyrics_document


@dataclass(frozen=True, slots=True)
class ReferenceQuality:
    token_similarity: float
    matched_word_ratio: float
    onset_mae_seconds: float | None
    onset_p95_seconds: float | None
    pitch_match_ratio: float
    note_duration_mae_seconds: float | None
    note_duration_ratio: float | None
    matched_words: int
    reference_words: int


def _identity(value: object) -> str:
    return " ".join(re.findall(r"[\w']+", str(value).casefold(), flags=re.UNICODE))


def _word_tokens(document: dict[str, Any]) -> tuple[list[str], list[int]]:
    tokens, owners = [], []
    for index, word in enumerate(document["words"]):
        for token in _identity(word["text"]).split():
            tokens.append(token)
            owners.append(index)
    return tokens, owners


def _percentile(values: list[float], fraction: float) -> float | None:
    if not values:
        return None
    ordered = sorted(values)
    index = round((len(ordered) - 1) * fraction)
    return round(ordered[index], 6)


def _notes(word: dict[str, Any]) -> tuple[float, ...]:
    return tuple(float(note["note"]) for note in word.get("notes", []))


def _note_duration(word: dict[str, Any]) -> float:
    return sum(
        float(note["end"]) - float(note["start"])
        for note in word.get("notes", [])
    )


def _pitch_distance(left: float, right: float) -> float:
    difference = abs(left - right) % 12
    return min(difference, 12 - difference)


def compare_lyrics_documents(
    reference: dict[str, Any], candidate: dict[str, Any]
) -> ReferenceQuality:
    expected = validate_lyrics_document(copy.deepcopy(reference))
    actual = validate_lyrics_document(copy.deepcopy(candidate))
    expected_tokens, expected_owners = _word_tokens(expected)
    actual_tokens, actual_owners = _word_tokens(actual)
    matcher = SequenceMatcher(None, expected_tokens, actual_tokens, autojunk=False)
    pairs: list[tuple[int, int]] = []
    for block in matcher.get_matching_blocks():
        pairs.extend(
            (expected_owners[block.a + offset], actual_owners[block.b + offset])
            for offset in range(block.size)
        )
    pairs = list(dict.fromkeys(pairs))
    onset_errors = [
        abs(float(expected["words"][left]["start"]) - float(actual["words"][right]["start"]))
        for left, right in pairs
    ]
    pitch_pairs = [
        (_notes(expected["words"][left]), _notes(actual["words"][right]))
        for left, right in pairs
    ]
    pitch_pairs = [(left, right) for left, right in pitch_pairs if left and right]
    pitch_matches = sum(
        any(_pitch_distance(expected_note, actual_note) <= 1.0
            for expected_note in left for actual_note in right)
        for left, right in pitch_pairs
    )
    note_duration_pairs = [
        (
            _note_duration(expected["words"][left]),
            _note_duration(actual["words"][right]),
        )
        for left, right in pairs
        if _note_duration(expected["words"][left]) > 0
    ]
    note_duration_errors = [
        abs(expected_duration - actual_duration)
        for expected_duration, actual_duration in note_duration_pairs
    ]
    expected_note_duration = sum(left for left, _right in note_duration_pairs)
    actual_note_duration = sum(right for _left, right in note_duration_pairs)
    reference_words = len(expected["words"])
    return ReferenceQuality(
        token_similarity=round(matcher.ratio(), 6),
        matched_word_ratio=round(len({left for left, _right in pairs}) / max(1, reference_words), 6),
        onset_mae_seconds=(
            round(sum(onset_errors) / len(onset_errors), 6) if onset_errors else None
        ),
        onset_p95_seconds=_percentile(onset_errors, 0.95),
        pitch_match_ratio=round(pitch_matches / max(1, len(pitch_pairs)), 6),
        note_duration_mae_seconds=(
            round(sum(note_duration_errors) / len(note_duration_errors), 6)
            if note_duration_errors else None
        ),
        note_duration_ratio=(
            round(actual_note_duration / expected_note_duration, 6)
            if expected_note_duration else None
        ),
        matched_words=len({left for left, _right in pairs}),
        reference_words=reference_words,
    )
