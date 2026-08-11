from __future__ import annotations

import types

from AI.engines.ctc_alignment import _expected_duration
from AI.music import _estimate_tempo


def test_ctc_expected_duration_no_long_line_hard_cap():
    # A genuinely long sung line must not be silently clamped to a universal 10s.
    tokens=["протяжное"]*40
    assert _expected_duration(tokens) > 10.0


def test_tempo_does_not_force_legitimate_slow_meter_to_double(monkeypatch):
    import AI.music as music
    values=iter([(58.0, 12, 0.95),(116.0, 24, 0.30)])
    monkeypatch.setattr(music,"_tracked_tempo",lambda *a,**k: next(values))
    bpm,confidence,diag=_estimate_tempo(types.SimpleNamespace(), object(), 22050)
    assert bpm == 58.0
    assert 58.0 in diag["raw_tempo_candidates"]
    assert confidence > 0.5
