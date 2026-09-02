from __future__ import annotations

from ..models import Word


def _repair_duplicate_onsets(
    words: list[Word],
    entries: list[tuple[float, int, int]],
    tokens: list[str],
    span: float,
) -> None:
    for line_index, (_line_start, lower, upper) in enumerate(entries):
        position = lower
        line_end = (
            min(span, entries[line_index + 1][0])
            if line_index + 1 < len(entries) else span
        )
        while position < upper - 1:
            run_end = position + 1
            while (
                run_end < upper
                and abs(words[run_end].start - words[position].start) <= 1e-6
            ):
                run_end += 1
            if run_end == position + 1:
                position += 1
                continue
            boundary = (
                words[run_end].start
                if run_end < upper else min(
                    line_end,
                    max(word.end for word in words[position:run_end]),
                )
            )
            if boundary <= words[position].start + 0.01 * (run_end - position):
                position = run_end
                continue
            weights = [
                max(1, sum(character.isalnum() for character in token))
                for token in tokens[position:run_end]
            ]
            remaining = sum(weights)
            cursor = words[position].start
            for index, weight in zip(
                range(position, run_end), weights, strict=True
            ):
                end = (
                    boundary
                    if index == run_end - 1
                    else cursor + (boundary - cursor) * weight / remaining
                )
                original = words[index]
                words[index] = Word(
                    cursor,
                    end,
                    original.text,
                    min(original.confidence, 0.5),
                    original.index,
                )
                cursor = end
                remaining -= weight
            position = run_end


def _repair_final_preposition_words(
    words: list[Word],
    entries: list[tuple[float, int, int]],
    tokens: list[str],
    span: float,
) -> None:
    short_prepositions = {"в", "с", "к", "з"}
    for line_index, (_line_start, lower, upper) in enumerate(entries):
        if upper - lower < 2 or line_index + 1 >= len(entries):
            continue
        line_end = min(span, entries[line_index + 1][0])
        preposition_index, lexical_index = upper - 2, upper - 1
        preposition = "".join(
            char for char in tokens[preposition_index].casefold() if char.isalnum()
        )
        left, right = words[preposition_index], words[lexical_index]
        if (
            preposition in short_prepositions
            and right.start >= line_end - 0.15
            and right.start - left.start >= 1.0
        ):
            words[lexical_index] = Word(
                left.start,
                max(left.start + 0.01, min(line_end, right.end)),
                right.text,
                0.0,
                right.index,
            )


def _line_identity(tokens: list[str]) -> tuple[str, ...]:
    return tuple(
        "".join(char for char in token.casefold() if char.isalnum())
        for token in tokens
    )


def _repeated_shape_is_outlier(template: list[Word], group: list[Word]) -> bool:
    template_span = template[-1].start - template[0].start
    current_span = group[-1].start - group[0].start
    template_duration = template[-1].end - template[0].start
    current_duration = group[-1].end - group[0].start
    if template_span <= 0:
        return False
    relative_error = max(
        abs(
            (current.start - group[0].start)
            - (expected.start - template[0].start)
        )
        for expected, current in zip(template, group, strict=True)
    )
    return (
        relative_error > max(1.5, template_span * 0.45)
        or not 0.6 <= current_span / template_span <= 1.6
        or current_duration > max(
            template_duration * 2.5,
            template_duration + 2.0,
        )
    )


def _repair_repeated_line_shapes(
    words: list[Word],
    entries: list[tuple[float, int, int]],
    tokens: list[str],
    span: float,
) -> None:
    templates: dict[tuple[str, ...], list[Word]] = {}
    for line_index, (_line_start, lower, upper) in enumerate(entries):
        identity = _line_identity(tokens[lower:upper])
        group = words[lower:upper]
        template = templates.get(identity)
        if template is None:
            prefix_templates = [
                (
                    sum(
                        expected != current
                        for expected, current in zip(
                            candidate_identity[:len(identity)],
                            identity,
                            strict=True,
                        )
                    ),
                    len(candidate_identity),
                    candidate[:len(identity)],
                )
                for candidate_identity, candidate in templates.items()
                if (
                    len(candidate_identity) > len(identity)
                    and sum(
                        expected != current
                        for expected, current in zip(
                            candidate_identity[:len(identity)],
                            identity,
                            strict=True,
                        )
                    ) <= 1
                )
            ]
            if prefix_templates:
                template = min(prefix_templates, key=lambda item: item[:2])[2]
        if template is None:
            templates[identity] = list(group)
            continue
        if len(group) < 2 or not _repeated_shape_is_outlier(template, group):
            continue
        line_end = (
            min(span, entries[line_index + 1][0])
            if line_index + 1 < len(entries) else span
        )
        anchor = group[0].start
        repaired = []
        for expected, current in zip(template, group, strict=True):
            start = anchor + expected.start - template[0].start
            end = anchor + expected.end - template[0].start
            if start >= line_end:
                repaired = []
                break
            repaired.append(Word(
                start,
                max(start + 0.01, min(line_end, end)),
                current.text,
                min(current.confidence, expected.confidence),
                current.index,
            ))
        if repaired:
            words[lower:upper] = repaired
            templates[identity] = list(repaired)


def repair_timed_line_outliers(
    words: list[Word],
    entries: list[tuple[float, int, int]],
    tokens: list[str],
    span: float,
) -> None:
    """Repair gross CTC line geometry using evidence from the same recording."""
    _repair_duplicate_onsets(words, entries, tokens, span)
    _repair_final_preposition_words(words, entries, tokens, span)
    _repair_repeated_line_shapes(words, entries, tokens, span)
