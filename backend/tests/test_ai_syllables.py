from tests._shared import patch_attrs, pitch_frame

import pytest

from AI import syllables
from AI.models import PitchFrame, Word


frame = lambda time, frequency=220, confidence=0.9, voiced=True, energy=0.8: pitch_frame(time, frequency, confidence, voiced, energy)


@pytest.mark.parametrize(
    ("text", "expected"),
    [
        ("", []),
        ("!!!", ["!!!"]),
        ("test", ["test"]),
        ("мама", ["ма", "ма"]),
        ("строка", ["стро", "ка"]),
        ("audio!", ["a", "u", "di", "o"]),
    ],
)
def test_split_written(text, expected):
    assert syllables.split_written(text) == expected


def test_frame_slice_and_local_step():
    pitch = [frame(0), frame(0.01), frame(0.02), frame(0.2)]
    assert (syllables._frame_slice(pitch, [item.time for item in pitch], 0.01, 0.02) == pitch[1:3]) and (syllables._local_step(pitch, 1, 2) == pytest.approx(0.01)) and (syllables._local_step([], 1.2, 2) == pytest.approx(0.1))


def test_boundary_scores_require_enough_interior_evidence():
    word = Word(0, 1, "мама")
    assert syllables._boundary_scores(word, [frame(0)], 2) == []
    near_edge = [frame(i / 100) for i in range(6)]
    assert syllables._boundary_scores(word, near_edge, 2) == []
    edges = [frame(i / 10) for i in range(6)]
    assert syllables._boundary_scores(word, edges, 2) == []


def test_boundary_scores_rank_acoustic_changes():
    word, frames = Word(0, 1, 'мама', index=0), []
    for index in range(11):
        before = index < 5
        frames.append(
            frame(
                index / 10,
                220 if before else 440,
                0.9 if before else 0.3,
                voiced=index != 5,
                energy=0.9 if before else 0.2,
            )
        )
    scores = syllables._boundary_scores(word, frames, 2)
    assert len(scores) == 1 and 0.2 < scores[0] < 0.8


def test_proportional_and_refined_bounds(monkeypatch):
    word = Word(1, 5, "мама")
    expected = syllables._proportional_bounds(word, ["ма", "ма"])
    assert (expected == [3]) and (syllables._refine_proportional_bounds(word, [], expected) == expected)
    frames = [frame(1 + i * 0.2) for i in range(21)]
    monkeypatch.setattr(syllables, "_boundary_scores", lambda *_: [])
    assert syllables._refine_proportional_bounds(word, frames, expected) == expected
    monkeypatch.setattr(syllables, "_boundary_scores", lambda *_: [2.9])
    assert syllables._refine_proportional_bounds(word, frames, expected) == [2.9]
    monkeypatch.setattr(syllables, "_boundary_scores", lambda *_: [1.1])
    assert syllables._refine_proportional_bounds(word, frames, expected) == expected


def test_align_syllables_proportional_and_chronological(monkeypatch):
    words = [
        Word(1, 2, "мама", confidence=1, index=1),
        Word(0, 1, "test", confidence=0.5, index=0),
        Word(2, 3, "!!!", confidence=1, index=2),
    ]
    result = syllables.align_syllables(words, [])
    assert ([item.text for item in result] == ['test', 'ма', 'ма', '!!!']) and ([item.index for item in result] == list(range(4))) and (result[0].confidence == pytest.approx(0.29))

    patch_attrs(monkeypatch, syllables, _refine_proportional_bounds=lambda _w, _f, values: [values[0] + 0.1] if values else values)
    acoustic = syllables.align_syllables([Word(0, 1, "мама", confidence=2 / 3)], [])
    assert acoustic[0].confidence == pytest.approx((2 / 3) * 0.92)
