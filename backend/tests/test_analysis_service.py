from tests._shared import make_song, patch_attrs, raises, patch_many

import pytest

import models
from app.services import analysis_service


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


def test_reference_index_sorts_notes_and_respects_half_open_ranges():
    index = analysis_service.ReferenceIndex.build(
        [
            {"start": 2, "end": 3, "note": "D4"},
            {"start": 0, "end": 1, "midi": 60},
            {"start": 1, "pitch": "C#4"},
        ]
    )
    assert (index.starts == (0, 1, 2)) and (index.note_at(-1) is None) and (index.note_at(0.5) == 60) and (index.note_at(1) is None) and (index.note_at(2.5) == 62) and (index.note_at(3) is None)


def domain_song(output_dir=None): return make_song(output_dir=output_dir)


def test_analysis_requires_processed_reference(monkeypatch, tmp_path):
    recording = models.Recording(song_id="song", filename="take.wav", path="take.wav")
    raises(ValueError, lambda: analysis_service.analyze_recording(recording, domain_song()), match='нет эталонной')

    patch_many(monkeypatch, (analysis_service.song_service, "resolve_output_dir", lambda _song: tmp_path), (analysis_service.ai_bridge, "get_reference_notes", lambda _path: []), (analysis_service, "read_json", lambda _path: []))
    raises(ValueError, lambda: analysis_service.analyze_recording(recording, domain_song(str(tmp_path))), match='reference.json')


def test_analysis_filters_invalid_frames_and_calculates_sections(monkeypatch, tmp_path):
    recording, reference, structure, frames = models.Recording(song_id='song', filename='take.wav', path='take.wav'), [{'start': 0, 'end': 1, 'midi': 60}, {'start': 1, 'end': 2, 'note': 'D4'}], [{'label': 'verse', 'start': 0, 'end': 1}, {'name': 'chorus', 'start': 1, 'end': 2}, {'label': 'invalid', 'start': 'x', 'end': 3}, {'label': 'empty', 'start': 5, 'end': 6}], [{'time': 0.25, 'midi': 60}, {'time': 0.75, 'note': 'C#4'}, {'time': 1.5, 'midi': 62}, {'time': 3, 'midi': 60}, {'time': 'bad', 'midi': 60}, {'time': 0.5, 'note': 'bad'}]
    patch_many(monkeypatch, (analysis_service.song_service, "resolve_output_dir", lambda _song: tmp_path), (analysis_service.ai_bridge, "get_reference_notes", lambda _path: reference), (analysis_service, "read_json", lambda _path: structure), (analysis_service.ai_bridge, "analyze_vocal", lambda _p: frames))

    result = analysis_service.analyze_recording(recording, domain_song(str(tmp_path)))

    assert (result['pitch_accuracy_percent'], result['mean_deviation_semitones'], result['sections']) == (66.7, 0.333, [{'label': 'verse', 'start': 0, 'end': 1, 'accuracy_percent': 50.0, 'mean_deviation_semitones': 0.5}, {'label': 'chorus', 'start': 1, 'end': 2, 'accuracy_percent': 100.0, 'mean_deviation_semitones': 0.0}, {'label': 'empty', 'start': 5, 'end': 6, 'accuracy_percent': None, 'mean_deviation_semitones': None}])


def test_analysis_returns_empty_metrics_without_comparable_frames(monkeypatch, tmp_path):
    recording = models.Recording(song_id="song", filename="take.wav", path="take.wav")
    monkeypatch.setattr(analysis_service.song_service, "resolve_output_dir", lambda _song: tmp_path)
    patch_attrs(monkeypatch, analysis_service.ai_bridge, get_reference_notes=lambda _path: [{'start': 0, 'end': 1, 'midi': 60}])
    patch_many(monkeypatch, (analysis_service, "read_json", lambda _path: {"not": "sections"}), (analysis_service.ai_bridge, "analyze_vocal", lambda _p: []))
    assert analysis_service.analyze_recording(recording, domain_song(str(tmp_path))) == {
        "pitch_accuracy_percent": None,
        "mean_deviation_semitones": None,
        "sections": None,
    }
