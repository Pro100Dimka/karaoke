import pytest

import models
from app.services import analysis_service
from tests._shared import make_song, patch_attrs, patch_many, raises


@pytest.mark.parametrize(
    ("value", "expected"),
    [
        (60, 60),
        (60.6, 61),
        ("C4", 60),
        ("C#4", 61),
        ("Db4", 61),
        (" H4 ", None),
        ("Cbad", None),
        (None, None),
        ("", None),
    ],
)
def test_note_values_convert_to_midi(value, expected):
    assert analysis_service._to_midi(value) == expected


def test_overall_score_uses_the_weights_shown_in_the_result_modal():
    assert analysis_service._overall_score(30.2, 3.3, 61.5, 4.7) == 25.6


def test_reference_index_sorts_notes_and_respects_half_open_ranges():
    index = analysis_service.ReferenceIndex.build(
        [
            {"start": 2, "end": 3, "note": 62},
            {"start": 0, "end": 1, "note": 60},
            {"start": 1, "note": 61},
        ]
    )
    assert (index.starts == (0, 1, 2)) and (index.note_at(-1) is None) and (index.note_at(0.5) == 60) and (index.note_at(1) is None) and (index.note_at(2.5) == 62) and (index.note_at(3) is None)


def test_reference_index_drops_notes_with_a_null_start_and_falls_back_end_to_start(monkeypatch):
    # Regression test: dict.get(key, default) only substitutes default when
    # the key is MISSING, not when its value is an explicit null -- a note
    # with "start": null (or a non-numeric start) used to crash the whole
    # index via float(None), unlike _normalized_reference_notes' isinstance
    # guard for this exact same input a few lines below in analyze_recording.
    index = analysis_service.ReferenceIndex.build(
        [
            {"start": None, "end": 1, "note": 60},
            {"start": "bad", "end": 1, "note": 60},
            {"start": 2, "end": None, "note": 61},
            {"start": 3, "note": 62},
        ]
    )
    # Both surviving notes' "end" resolves to their own start (one via an
    # explicit null, one via the key being absent), giving each a zero-width
    # half-open range -- note_at() correctly reports neither as covered at
    # any timestamp; what matters here is that building the index didn't
    # crash on the two invalid-start notes above.
    assert index.starts == (2, 3)
    assert index.note_at(2) is None and index.note_at(3) is None


def domain_song(output_dir=None): return make_song(output_dir=output_dir)


def test_analysis_requires_processed_reference(monkeypatch, tmp_path):
    recording = models.Recording(song_id="song", filename="take.wav", path="take.wav")
    raises(ValueError, lambda: analysis_service.analyze_recording(recording, domain_song()), match='нет эталонной')

    patch_many(monkeypatch, (analysis_service.song_service, "resolve_output_dir", lambda _song: tmp_path), (analysis_service.ai_bridge, "get_reference_notes", lambda _path: []), (analysis_service, "read_json", lambda _path: []))
    raises(ValueError, lambda: analysis_service.analyze_recording(recording, domain_song(str(tmp_path))), match='вокальные ноты')


def test_analysis_filters_invalid_frames_and_calculates_sections(monkeypatch, tmp_path):
    recording, reference, structure, frames = models.Recording(song_id='song', filename='take.wav', path='take.wav'), [{'start': 0, 'end': 1, 'note': 60}, {'start': 1, 'end': 2, 'note': 62}], [{'label': 'verse', 'start': 0, 'end': 1}, {'name': 'chorus', 'start': 1, 'end': 2}, {'label': 'invalid', 'start': 'x', 'end': 3}, {'label': 'empty', 'start': 5, 'end': 6}], [{'time': 0.25, 'midi': 60}, {'time': 0.75, 'note': 'C#4'}, {'time': 1.5, 'midi': 62}, {'time': 3, 'midi': 60}, {'time': 'bad', 'midi': 60}, {'time': 0.5, 'note': 'bad'}]
    patch_many(monkeypatch, (analysis_service.song_service, "resolve_output_dir", lambda _song: tmp_path), (analysis_service.ai_bridge, "get_reference_notes", lambda _path: reference), (analysis_service, "read_json", lambda _path: structure), (analysis_service.ai_bridge, "analyze_vocal", lambda _p: frames))

    result = analysis_service.analyze_recording(recording, domain_song(str(tmp_path)))

    assert (result['pitch_accuracy_percent'], result['mean_deviation_semitones'], result['sections']) == (66.7, 0.333, [{'label': 'verse', 'start': 0, 'end': 1, 'accuracy_percent': 50.0, 'mean_deviation_semitones': 0.5}, {'label': 'chorus', 'start': 1, 'end': 2, 'accuracy_percent': 100.0, 'mean_deviation_semitones': 0.0}, {'label': 'empty', 'start': 5, 'end': 6, 'accuracy_percent': None, 'mean_deviation_semitones': None}])
    assert (
        result["rhythm_accuracy_percent"],
        result["note_hold_percent"],
        result["note_coverage_percent"],
        result["overall_score_percent"],
    ) == (28.6, 100.0, 100.0, 65.5)


def test_analysis_tolerates_a_corrupted_structure_json(monkeypatch, tmp_path):
    # Regression test: analyze_recording used to call read_json(structure.json)
    # unguarded, unlike the equivalent read in pipeline_service.py
    # (_read_optional_generated_json) -- a crash mid-write (or any other
    # interference) leaving that file partially written/corrupt raised
    # json.JSONDecodeError straight out of the whole recording analysis,
    # even though a MISSING structure.json is already tolerated fine
    # (isinstance(structure, list) below just skips the section breakdown).
    import json as json_module

    recording = models.Recording(song_id='song', filename='take.wav', path='take.wav')
    reference = [{'start': 0, 'end': 1, 'note': 60}]

    def broken_read_json(_path):
        raise json_module.JSONDecodeError("corrupt", "", 0)

    patch_many(
        monkeypatch,
        (analysis_service.song_service, "resolve_output_dir", lambda _song: tmp_path),
        (analysis_service.ai_bridge, "get_reference_notes", lambda _path: reference),
        (analysis_service, "read_json", broken_read_json),
        (analysis_service.ai_bridge, "analyze_vocal", lambda _p: [{'time': 0.5, 'midi': 60}]),
    )

    result = analysis_service.analyze_recording(recording, domain_song(str(tmp_path)))
    assert result["sections"] is None


def test_analysis_shifts_take_relative_frames_by_persisted_playback_offset(monkeypatch, tmp_path):
    # The take was started at song time 90s (e.g. the user seeked before recording),
    # so its own pitch frames are relative to take-time 0 — they must be shifted by
    # the persisted offset before being compared against absolute song-time notes.
    recording = models.Recording(song_id='song', filename='take.wav', path='take.wav', playback_offset_sec=90.0)
    reference = [{'start': 90, 'end': 91, 'note': 60}, {'start': 91, 'end': 92, 'note': 62}]
    frames = [{'time': 0.25, 'midi': 60}, {'time': 1.25, 'midi': 62}]
    patch_many(
        monkeypatch,
        (analysis_service.song_service, "resolve_output_dir", lambda _song: tmp_path),
        (analysis_service.ai_bridge, "get_reference_notes", lambda _path: reference),
        (analysis_service, "read_json", lambda _path: []),
        (analysis_service.ai_bridge, "analyze_vocal", lambda _p: frames),
    )

    result = analysis_service.analyze_recording(recording, domain_song(str(tmp_path)))

    assert (result['pitch_accuracy_percent'], result['mean_deviation_semitones']) == (100.0, 0.0)


def test_analysis_maps_frames_through_play_pause_and_seek_segments(monkeypatch, tmp_path):
    recording = models.Recording(
        song_id="song",
        filename="take.wav",
        path="take.wav",
        playback_segments_json=(
            '[{"start_recording_sec":0.2,"end_recording_sec":1.2,'
            '"start_playback_sec":10.0},{"start_recording_sec":1.2,'
            '"end_recording_sec":2.2,"start_playback_sec":20.0}]'
        ),
    )
    reference = [
        {"start": 10, "end": 11, "note": 60},
        {"start": 20, "end": 21, "note": 62},
    ]
    frames = [
        {"time": 0.1, "midi": 70},  # before playback began: ignored
        {"time": 0.45, "midi": 60},
        {"time": 1.45, "midi": 62},
    ]
    patch_many(
        monkeypatch,
        (analysis_service.song_service, "resolve_output_dir", lambda _song: tmp_path),
        (analysis_service.ai_bridge, "get_reference_notes", lambda _path: reference),
        (analysis_service, "read_json", lambda _path: []),
        (analysis_service.ai_bridge, "analyze_vocal", lambda _path: frames),
    )

    result = analysis_service.analyze_recording(recording, domain_song(str(tmp_path)))

    assert result["pitch_accuracy_percent"] == 100.0
    assert result["note_coverage_percent"] == 100.0


def test_analysis_does_not_penalize_rhythm_and_coverage_for_notes_after_an_early_stop(monkeypatch, tmp_path):
    # The take stops at song time 1s (segment ends there); a reference note
    # starting well after that point was never attempted and must not count
    # as a missed/off-rhythm note against a perfectly sung partial take.
    recording = models.Recording(
        song_id="song",
        filename="take.wav",
        path="take.wav",
        playback_segments_json='[{"start_recording_sec":0.0,"end_recording_sec":1.0,"start_playback_sec":0.0}]',
    )
    reference = [
        {"start": 0, "end": 1, "note": 60},
        {"start": 5, "end": 6, "note": 62},
    ]
    frames = [{"time": 0.0, "midi": 60}]
    patch_many(
        monkeypatch,
        (analysis_service.song_service, "resolve_output_dir", lambda _song: tmp_path),
        (analysis_service.ai_bridge, "get_reference_notes", lambda _path: reference),
        (analysis_service, "read_json", lambda _path: []),
        (analysis_service.ai_bridge, "analyze_vocal", lambda _path: frames),
    )

    result = analysis_service.analyze_recording(recording, domain_song(str(tmp_path)))

    assert result["rhythm_accuracy_percent"] == 100.0
    assert result["note_coverage_percent"] == 100.0


def test_analysis_returns_empty_metrics_without_comparable_frames(monkeypatch, tmp_path):
    recording = models.Recording(song_id="song", filename="take.wav", path="take.wav")
    monkeypatch.setattr(analysis_service.song_service, "resolve_output_dir", lambda _song: tmp_path)
    patch_attrs(monkeypatch, analysis_service.ai_bridge, get_reference_notes=lambda _path: [{'start': 0, 'end': 1, 'midi_note': 60}])
    patch_many(monkeypatch, (analysis_service, "read_json", lambda _path: {"not": "sections"}), (analysis_service.ai_bridge, "analyze_vocal", lambda _p: []))
    assert analysis_service.analyze_recording(recording, domain_song(str(tmp_path))) == {
        "pitch_accuracy_percent": None,
        "mean_deviation_semitones": None,
        "rhythm_accuracy_percent": None,
        "note_hold_percent": None,
        "note_coverage_percent": None,
        "overall_score_percent": None,
        "sections": None,
    }
