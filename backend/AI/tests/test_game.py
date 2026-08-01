from src.analyze.game import _merge_machine_fragments, _remove_transient_outliers


def _note(name: str, start: float, end: float) -> dict:
    return {"note": name, "start": start, "end": end, "duration": round(end - start, 3)}


def test_merge_machine_fragments_collapses_only_tiny_duplicate_events():
    notes = _merge_machine_fragments(
        [
            _note("G3", 1.0, 1.05),
            _note("G3", 1.05, 1.2),
            _note("G#3", 1.2, 1.4),
        ]
    )

    assert notes == [
        {"note": "G3", "start": 1.0, "end": 1.2, "duration": 0.2},
        {"note": "G#3", "start": 1.2, "end": 1.4, "duration": 0.2},
    ]


def test_merge_machine_fragments_keeps_a_real_pause():
    notes = _merge_machine_fragments(
        [
            _note("G3", 1.0, 1.05),
            _note("G3", 1.1, 1.2),
        ]
    )

    assert len(notes) == 2


def test_remove_transient_outliers_keeps_the_surrounding_melody():
    notes = _remove_transient_outliers(
        [
            _note("G#3", 1.0, 1.4),
            _note("C3", 1.4, 1.55),
            _note("G#3", 1.55, 2.0),
        ]
    )

    assert notes == [{"note": "G#3", "start": 1.0, "end": 2.0, "duration": 1.0}]
