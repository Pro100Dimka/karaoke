from __future__ import annotations

from collections import defaultdict
from typing import Any

from .engines.text import _vowel_weighted_length, tokenize
from .models import Syllable, VocalNote, Word, to_dict

KARAOKE_TIMELINE_VERSION = "v3-compressed-line-boundary-rebalance"

# CTC forced alignment marks the frame where a token becomes *recognizable*,
# not how long it's actually sung -- for a short/quiet function word (a
# single-letter "а"/"я", a preposition) that frame can be only a few tens of
# milliseconds wide even at high confidence. A word highlighted for 20ms is
# imperceptible: it flashes and is gone before a viewer can register it,
# which reads as the highlight stalling on the *previous* word until the
# next one arrives. This is a display-only floor applied after every upstream
# alignment/interpolation decision has already been made, so it never
# changes which words are trusted or how gaps between real anchors are
# filled -- it only stretches an already-accepted word into silence that
# already exists before the next item, never past it.
_MIN_DISPLAY_DURATION = 0.10


def _safe_float(value: Any, default: float) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return default


def _extend_micro_duration_spans(items: list[dict[str, Any]], total_duration: float) -> None:
    ordered = sorted(
        range(len(items)), key=lambda index: _safe_float(items[index].get("start"), 0.0)
    )
    for position, index in enumerate(ordered):
        item = items[index]
        start = _safe_float(item.get("start"), 0.0)
        end = _safe_float(item.get("end"), start)
        if end - start >= _MIN_DISPLAY_DURATION:
            continue
        if position + 1 < len(ordered):
            next_start = _safe_float(items[ordered[position + 1]].get("start"), total_duration)
        else:
            next_start = total_duration
        target_end = min(next_start, start + _MIN_DISPLAY_DURATION)
        if target_end > end:
            item["end"] = target_end


def _remap(value: float, old_start: float, old_end: float, new_start: float, new_end: float) -> float:
    old_span = old_end - old_start
    if old_span <= 0:
        return new_start
    ratio = (value - old_start) / old_span
    return new_start + ratio * (new_end - new_start)


def _retime_line_words(words: list[dict[str, Any]], start: float, end: float) -> None:
    weights = [_vowel_weighted_length(str(word.get("text", ""))) for word in words]
    total_weight = sum(weights) or 1.0
    cursor = start
    span = end - start
    for word, weight in zip(words, weights, strict=True):
        old_start = _safe_float(word.get("start"), cursor)
        old_end = _safe_float(word.get("end"), old_start)
        word_start = cursor
        cursor += span * weight / total_weight
        word["start"] = word_start
        word["end"] = cursor
        for syllable in word.get("syllables") or []:
            syllable["start"] = _remap(
                _safe_float(syllable.get("start"), old_start), old_start, old_end, word_start, cursor
            )
            syllable["end"] = _remap(
                _safe_float(syllable.get("end"), old_end), old_start, old_end, word_start, cursor
            )
    words[-1]["end"] = end


def _rebalance_compressed_line_boundaries(lines: list[dict[str, Any]]) -> None:
    """Fix a whole line flying by before the singer has actually said it.

    Two touching lines can end up split disproportionately to their word
    counts when the aligner is uncertain right at their shared boundary --
    one line collapses to well under a second while its neighbour keeps
    several normal-paced seconds, so the highlight jumps ahead to the next
    line before the current one has really finished. Move the shared
    boundary to a fairer split (the same vowel-weighted length used for
    interpolated words, see engines/text.py) only when it is clearly off,
    and only between lines that already touch with no gap -- this never
    invents time that wasn't already inside these two lines' own envelope,
    and a genuine musical pause between lines is left alone.
    """
    for index in range(len(lines) - 1):
        first, second = lines[index], lines[index + 1]
        if abs(float(first["end"]) - float(second["start"])) > 1e-6:
            continue
        first_words = first.get("words") or []
        second_words = second.get("words") or []
        if not first_words or not second_words:
            continue
        first_weight = sum(_vowel_weighted_length(str(w.get("text", ""))) for w in first_words)
        second_weight = sum(_vowel_weighted_length(str(w.get("text", ""))) for w in second_words)
        span_start = float(first["start"])
        span_end = float(second["end"])
        total = span_end - span_start
        if total <= 0 or (first_weight + second_weight) <= 0:
            continue
        fair_boundary = span_start + total * first_weight / (first_weight + second_weight)
        current_boundary = float(first["end"])
        # Only step in when the current split shortchanges the first line
        # noticeably; leave an already-reasonable split alone.
        if current_boundary >= fair_boundary * 0.85:
            continue
        _retime_line_words(first_words, span_start, fair_boundary)
        _retime_line_words(second_words, fair_boundary, span_end)
        first["end"] = fair_boundary
        second["start"] = fair_boundary


def _dict(item: Any) -> dict[str, Any]:
    return dict(item) if isinstance(item, dict) else dict(to_dict(item))


def _integer(value: Any, default: int | None = None) -> int | None:
    try:
        return int(value)
    except (TypeError, ValueError):
        return default


def _midi(note: dict[str, Any]) -> int | None:
    raw = note.get("midi_note", note.get("midi"))
    try:
        value = int(round(float(raw)))
    except (TypeError, ValueError):
        return None
    return value if 0 <= value <= 127 else None


def _positive_duration(note: dict[str, Any]) -> float:
    try:
        return max(0.0, float(note.get("end", 0.0)) - float(note.get("start", 0.0)))
    except (TypeError, ValueError):
        return 0.0


def _merge_display_notes(notes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Expose acoustic/game events without merging genuine repeated notes."""
    clean = [
        dict(note) for note in notes if _midi(note) is not None and _positive_duration(note) > 0.0
    ]
    for note in clean:
        note["midi_note"] = _midi(note)
        note["display_source"] = "acoustic_game_note"
    clean.sort(key=lambda item: (float(item["start"]), float(item["end"]), int(item["midi_note"])))
    return clean


def _syllable_indices(note: dict[str, Any]) -> tuple[int, ...]:
    raw = note.get("syllable_indices")
    values = raw if isinstance(raw, (list, tuple, set)) else (note.get("syllable_index"),)
    return tuple(dict.fromkeys(index for value in values if (index := _integer(value)) is not None))


def build_karaoke_song_map(
    *,
    lyrics_text: str,
    words: list[Word],
    syllables: list[Syllable],
    game_notes: list[VocalNote],
    duration: float,
    bpm: float,
    key: str | None,
    ai_build_id: str,
    note_decoder_version: str,
) -> dict[str, Any]:
    word_payload = [_dict(item) for item in words]
    syllable_payload = [_dict(item) for item in syllables]
    note_payload = [_dict(item) for item in game_notes]
    display_notes = _merge_display_notes(note_payload)
    _extend_micro_duration_spans(word_payload, float(duration))
    _extend_micro_duration_spans(syllable_payload, float(duration))

    syllables_by_word: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for item in syllable_payload:
        word_index = _integer(item.get("word_index"))
        if word_index is None:
            continue
        syllables_by_word[word_index].append(item)
    display_by_syllable: dict[int, list[dict[str, Any]]] = defaultdict(list)
    for item in display_notes:
        for syllable_index in _syllable_indices(item):
            display_by_syllable[syllable_index].append(item)

    for values in syllables_by_word.values():
        values.sort(
            key=lambda item: (float(item.get("start", 0.0)), _integer(item.get("index"), 0))
        )
    for values in display_by_syllable.values():
        values.sort(key=lambda item: (float(item.get("start", 0.0)), float(item.get("end", 0.0))))

    prepared_words: list[dict[str, Any]] = []
    for index, source in enumerate(word_payload):
        word = dict(source)
        word_index = _integer(word.get("index"), index)
        linked_syllables: list[dict[str, Any]] = []
        for source_syllable in syllables_by_word.get(word_index, []):
            syllable = dict(source_syllable)
            syllable_index = _integer(syllable.get("index"), -1)
            linked_notes = [dict(note) for note in display_by_syllable.get(syllable_index, [])]
            syllable["timing_source"] = "syllable_alignment"
            syllable["display_notes"] = linked_notes
            linked_syllables.append(syllable)
        word["timing_source"] = "word_alignment"
        word["syllables"] = linked_syllables
        prepared_words.append(word)

    line_texts = [line.strip() for line in str(lyrics_text or "").splitlines() if tokenize(line)]
    line_counts = [len(tokenize(line)) for line in line_texts]
    lines: list[dict[str, Any]] = []
    cursor = 0
    for line_index, (line_text, count) in enumerate(zip(line_texts, line_counts, strict=True)):
        is_last_line = line_index == len(line_texts) - 1
        line_words = (
            prepared_words[cursor:] if is_last_line else prepared_words[cursor : cursor + count]
        )
        cursor += count
        if not line_words:
            continue
        lines.append(
            {
                "index": line_index,
                "text": line_text,
                "start": min(float(word.get("start", 0.0)) for word in line_words),
                "end": max(float(word.get("end", 0.0)) for word in line_words),
                "words": line_words,
            }
        )
    _rebalance_compressed_line_boundaries(lines)

    return {
        "version": KARAOKE_TIMELINE_VERSION,
        "duration": float(duration),
        "bpm": float(bpm),
        "key": key,
        "ai_build_id": ai_build_id,
        "note_decoder_version": note_decoder_version,
        "words": word_payload,
        "syllables": syllable_payload,
        "notes": note_payload,
        "display_notes": display_notes,
        "lines": lines,
        "display_stats": {
            "game_note_count": len(note_payload),
            "display_note_count": len(display_notes),
            "syllable_count": len(syllable_payload),
        },
    }
