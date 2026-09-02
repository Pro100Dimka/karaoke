from __future__ import annotations

from types import SimpleNamespace

import pytest

from AI.engines.singing_score import (
    ScoreLine,
    SymbolicEvent,
    SymbolicScore,
    VocalParseScoreEngine,
    _checkpoint_embedding_vocab,
    _GenerationGuard,
    _score_generation_budget,
    _set_checkpoint_vocab_size,
    parse_vocalparse_score,
    project_song_scores,
    project_symbolic_score,
    trim_score_for_lyrics,
)
from AI.errors import ProcessingCancelledError
from AI.models import PitchFrame, VocalNote, Word


def test_vocalparse_parser_reads_symbolic_values_and_stops_events_at_bpm():
    raw = (
        "language Chinese<asr_text>И лампа<|file_sep|> "
        "SP <P_0> <NOTE_8> И <P_51> <NOTE_DOT_16> "
        "лам <P_57> <NOTE_8> <P_57> <NOTE_16> "
        "<BPM_89> hallucination <P_90> <NOTE_1> <BPM_91>"
    )

    score = parse_vocalparse_score(raw)

    assert score.bpm == 91
    assert score.events == (
        SymbolicEvent(0, 0.5, None, "SP"),
        SymbolicEvent(0.5, 0.375, 51, "И"),
        SymbolicEvent(0.875, 0.5, 57, "лам"),
        SymbolicEvent(1.375, 0.25, 57, None),
    )


def test_vocalparse_parser_rejects_output_without_a_complete_score():
    assert parse_vocalparse_score("текст без нот").events == ()
    assert parse_vocalparse_score("<P_64> <NOTE_4>").bpm is None


def test_vocalparse_parser_discards_hallucination_after_terminal_rest():
    score = parse_vocalparse_score(
        "гор <P_57> <NOTE_4> SP <P_0> <NOTE_8> "
        "然 <P_0> <NOTE_32> SP <P_0> <NOTE_16> <BPM_89>"
    )

    assert [(event.lyric, event.midi_note) for event in score.events] == [
        ("гор", 57), ("SP", None)
    ]


def test_score_is_trimmed_at_terminal_rest_after_most_of_expected_line():
    score = SymbolicScore(89, (
        SymbolicEvent(0, .5, 57, "гори"),
        SymbolicEvent(.5, 1, 57, None),
        SymbolicEvent(1.5, .5, None, "SP"),
        SymbolicEvent(2, 4, 90, None),
    ))

    trimmed = trim_score_for_lyrics(score, "горит")

    assert len(trimmed.events) == 3
    assert trimmed.events[-1].lyric == "SP"


def test_symbolic_projection_preserves_note_ratios_and_assigns_each_note_once():
    words = [
        Word(10.0, 10.4, "Первое", 1.0, 4),
        Word(10.5, 11.0, "второе", 1.0, 5),
    ]
    score = SymbolicScore(
        bpm=120,
        events=(
            SymbolicEvent(0.0, 0.5, 60, "Пер"),
            SymbolicEvent(0.5, 0.5, 62, None),
            SymbolicEvent(1.0, 1.0, 64, "вто"),
        ),
    )
    pitch = [
        PitchFrame(10.05, 261.63, 0.9, True),
        PitchFrame(10.30, 293.66, 0.9, True),
        PitchFrame(10.70, 329.63, 0.9, True),
    ]

    fitted_words, notes = project_symbolic_score(
        words, score, line_start=10.0, line_end=11.0, pitch=pitch
    )

    assert [(note.start, note.end) for note in notes] == [
        (10.0, 10.25), (10.25, 10.5), (10.5, 11.0)
    ]
    assert [note.word_index for note in notes] == [4, 4, 5]
    assert [note.midi_note for note in notes] == [60, 62, 64]
    assert fitted_words[0].end == 10.5
    assert fitted_words[1].end == 11.0


def test_symbolic_syllable_labels_keep_melismas_inside_their_word():
    words = [
        Word(20.45, 20.75, "И", 1.0, 0),
        Word(20.75, 21.35, "лампа", 1.0, 1),
        Word(21.35, 21.65, "не", 1.0, 2),
    ]
    score = SymbolicScore(89, (
        SymbolicEvent(0, .375, 53, "И"),
        SymbolicEvent(.375, .5, 57, "лам"),
        SymbolicEvent(.875, .375, 57, None),
        SymbolicEvent(1.25, .5, 58, "па"),
        SymbolicEvent(1.75, .5, 58, "не"),
    ))

    _fitted, notes = project_symbolic_score(
        words, score, line_start=20.45, line_end=21.65, pitch=[]
    )

    assert [note.word_index for note in notes] == [0, 1, 1, 1, 2]


def test_symbolic_projection_keeps_rests_but_does_not_publish_them_as_notes():
    words = [Word(1.0, 2.0, "слово", 1.0, 0)]
    score = SymbolicScore(
        bpm=100,
        events=(
            SymbolicEvent(0.0, 1.0, None, "SP"),
            SymbolicEvent(1.0, 1.0, 60, "сло"),
        ),
    )

    _fitted, notes = project_symbolic_score(
        words, score, line_start=1.0, line_end=3.0, pitch=[]
    )

    assert len(notes) == 1
    assert notes[0].start == 1.0
    assert notes[0].end == 1.6


def test_symbolic_projection_uses_physical_pitch_only_as_octave_anchor():
    words = [Word(0.0, 1.0, "слово", 1.0, 0)]
    score = SymbolicScore(
        bpm=100,
        events=(SymbolicEvent(0.0, 1.0, 48, "сло"),),
    )
    pitch = [PitchFrame(0.2, 523.25, 0.95, True)]  # approximately MIDI 72

    _fitted, notes = project_symbolic_score(
        words, score, line_start=0.0, line_end=1.0, pitch=pitch
    )

    assert notes[0].midi_note == 72


def test_physical_vocal_pitch_does_not_replace_the_symbolic_pitch_class():
    words = [Word(0.0, 1.0, "слово", 1.0, 0)]
    score = SymbolicScore(
        bpm=60,
        events=(SymbolicEvent(0.0, 1.0, 53, "слово"),),
    )
    pitch = [PitchFrame(0.2, 220.0, 0.95, True)]  # MIDI 57, not P_53

    _fitted, notes = project_symbolic_score(
        words, score, line_start=0.0, line_end=1.0, pitch=pitch
    )

    assert notes[0].midi_note == 53


def test_song_projection_replaces_the_old_duration_heuristic_line_by_line():
    words = [
        Word(1.0, 1.2, "один", 1.0, 0),
        Word(2.0, 2.2, "два", 1.0, 1),
    ]
    lines = [
        ScoreLine("один", 1.0, 1.5, 0, 0),
        ScoreLine("два", 2.0, 3.0, 1, 1),
    ]
    scores = [
        SymbolicScore(120, (SymbolicEvent(0, 1, 60, "о"),)),
        SymbolicScore(120, (SymbolicEvent(0, 1, 62, "два"),)),
    ]

    fitted, notes = project_song_scores(words, lines, scores, pitch=[])

    assert [(word.start, word.end) for word in fitted] == [(1.0, 1.5), (2.0, 2.5)]
    assert [(note.start, note.end, note.word_index) for note in notes] == [
        (1.0, 1.5, 0), (2.0, 2.5, 1)
    ]


def test_song_projection_uses_physical_notes_when_model_syllable_labels_are_wrong():
    words = [
        Word(1.0, 1.3, "первое", 1.0, 0),
        Word(1.5, 2.0, "второе", 1.0, 1),
    ]
    lines = [ScoreLine("первое второе", 1.0, 2.5, 0, 1)]
    # Both model labels incorrectly point at the first word.
    scores = [SymbolicScore(120, (
        SymbolicEvent(0, 1, 60, "пер"),
        SymbolicEvent(1, 1, 62, None),
    ))]
    physical = [
        VocalNote(1.05, 1.25, 60, word_index=0),
        VocalNote(1.55, 1.95, 64, word_index=1),
    ]

    fitted, notes = project_song_scores(
        words, lines, scores, pitch=[], physical_notes=physical
    )

    assert {note.word_index for note in notes} == {0, 1}
    assert [note.midi_note for note in notes] == [60, 64]
    assert fitted[0].end == 1.5
    assert fitted[1].end >= 2.0


def test_song_projection_uses_symbolic_pitch_with_physical_note_timing():
    words = [Word(1.0, 2.0, "слово", 1.0, 0)]
    lines = [ScoreLine("слово", 1.0, 2.0, 0, 0)]
    scores = [SymbolicScore(
        120,
        (SymbolicEvent(0, 1, 65, "слово"),),
    )]
    physical = [VocalNote(1.1, 1.8, 64, word_index=0)]

    _fitted, notes = project_song_scores(
        words,
        lines,
        scores,
        pitch=[PitchFrame(1.2, 261.63, 0.9, True)],
        physical_notes=physical,
    )

    assert len(notes) == 1
    assert notes[0].midi_note % 12 == 65 % 12
    assert notes[0].start == 1.0


def test_song_projection_rejects_symbolic_pitch_far_from_the_sung_note():
    words = [Word(1.0, 2.0, "слово", 1.0, 0)]
    lines = [ScoreLine("слово", 1.0, 2.0, 0, 0)]
    scores = [SymbolicScore(
        120,
        (SymbolicEvent(0, 1, 65, "слово"),),
    )]
    physical = [VocalNote(1.1, 1.8, 60, word_index=0)]

    _fitted, notes = project_song_scores(
        words,
        lines,
        scores,
        pitch=[PitchFrame(1.2, 261.63, 0.9, True)],
        physical_notes=physical,
    )

    assert notes[0].midi_note == 60


def test_score_engine_honours_cancellation_before_loading_the_large_model(tmp_path):
    engine = VocalParseScoreEngine(tmp_path)

    with pytest.raises(ProcessingCancelledError):
        engine.transcribe_lines(
            tmp_path / "missing.flac",
            [ScoreLine("строка", 0, 1, 0, 0)],
            cancelled=lambda: True,
        )


def test_checkpoint_embedding_vocab_is_applied_before_model_construction(tmp_path):
    import torch
    from safetensors.torch import save_file

    checkpoint = tmp_path / "model.safetensors"
    save_file({"thinker.model.embed_tokens.weight": torch.zeros(17, 4)}, checkpoint)
    config = SimpleNamespace(
        thinker_config=SimpleNamespace(
            text_config=SimpleNamespace(vocab_size=3),
        )
    )

    size = _checkpoint_embedding_vocab(checkpoint)
    _set_checkpoint_vocab_size(config, size)

    assert size == 17
    assert config.thinker_config.text_config.vocab_size == 17


def test_score_generation_budget_tracks_line_size_without_using_the_old_192_limit():
    short = _score_generation_budget("Короткая строка")
    long = _score_generation_budget("Очень длинная вокальная строка " * 4)

    assert 32 <= short < long <= 160


def test_generation_guard_stops_inside_a_batch_on_timeout_or_cancellation():
    import torch

    current = [10.0]
    guard = _GenerationGuard(
        cancelled=lambda: False,
        timeout_seconds=2.0,
        clock=lambda: current[0],
    )

    assert guard.should_stop() is False
    current[0] = 12.1
    assert guard.should_stop() is True
    assert _GenerationGuard(
        cancelled=lambda: True,
        timeout_seconds=20,
    ).should_stop() is True
    mask = guard(torch.ones((3, 2), dtype=torch.long), None)
    assert mask.shape == (3,)


def test_projection_repairs_zero_length_ctc_word_intervals():
    words = [Word(1.0, 1.0, "раз", 1.0, 0)]
    line = ScoreLine("раз", 1.0, 2.0, 0, 0)
    score = SymbolicScore(120, (SymbolicEvent(0, .5, 60, "раз"),))

    fitted, _notes = project_song_scores(words, [line], [score], pitch=[])

    assert fitted[0].end > fitted[0].start
