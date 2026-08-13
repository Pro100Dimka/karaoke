from __future__ import annotations

from dataclasses import dataclass

import pytest

from AI.models import PitchFrame, Syllable, TimeSpan, VocalNote, Word, to_dict


@pytest.mark.parametrize(
    "factory",
    [
        lambda: TimeSpan(-1, 0),
        lambda: TimeSpan(2, 1),
        lambda: TimeSpan(float("nan"), 1),
        lambda: Word(0, 1, " "),
        lambda: Word(0, 1, "x", index=-1),
        lambda: Word(0, 1, "x", confidence=2),
        lambda: Syllable(0, 1, " ", 0, 0),
        lambda: Syllable(0, 1, "x", -1, 0),
        lambda: PitchFrame(-1, 0, 0, False),
        lambda: PitchFrame(0, 0, 1, True),
        lambda: VocalNote(0, 1, -1),
        lambda: VocalNote(0, 1, 60, velocity=0),
        lambda: VocalNote(0, 1, 60, word_index=-1),
        lambda: VocalNote(0, 1, 60, syllable_index=-1),
        lambda: VocalNote(0, 1, 60, cents=((0.5, 0), (0.4, 0))),
        lambda: VocalNote(0, 1, 60, cents=((2, 0),)),
    ],
)
def test_invalid_ai_domain_values(factory):
    with pytest.raises(ValueError):
        factory()


def test_ai_domain_values_are_normalized():
    span = TimeSpan("1", "2")
    assert span.start == 1 and span.end == 2
    word = Word(0, 1, " hello ", confidence=".5", index="2")
    assert (word.text, word.confidence, word.index) == ("hello", 0.5, 2)
    syllable = Syllable(0, 1, " la ", "2", "3", confidence=".8")
    assert (syllable.text, syllable.word_index, syllable.index) == ("la", 2, 3)
    unvoiced = PitchFrame("1", 440, 0.9, False, "2")
    assert unvoiced.frequency == 0 and unvoiced.confidence == 0 and unvoiced.energy == 2
    voiced = PitchFrame(1, 440, 0.9, True)
    assert voiced.voiced and voiced.frequency == 440
    note = VocalNote(
        0, 1, "60", velocity="100", word_index="1", syllable_index="2", cents=((0, "2"), (1, 3))
    )
    assert note.midi_note == 60 and note.cents == ((0.0, 2.0), (1.0, 3.0))


def test_to_dict_only_converts_instances():
    @dataclass
    class Value:
        number: int

    assert to_dict(Value(2)) == {"number": 2}
    assert to_dict(Value) is Value
    assert to_dict({"number": 2}) == {"number": 2}
