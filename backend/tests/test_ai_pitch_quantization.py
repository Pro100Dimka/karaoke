import numpy as np
import pytest

from AI.pitch_quantization import midi_to_hz, quantize_voiced_points


def test_quantization_removes_vibrato_and_micro_pitch_spikes():
    times = [index * 0.01 for index in range(60)]
    midi = [60 + 0.45 * np.sin(index * 0.8) for index in range(60)]
    midi[25:27] = [64.0, 64.0]
    frequencies = [440 * 2 ** ((value - 69) / 12) for value in midi]

    locked = quantize_voiced_points(times, frequencies)

    assert locked == pytest.approx([midi_to_hz(60)] * len(times))


def test_quantization_preserves_sustained_real_note_changes_and_silence_boundaries():
    first_times = [index * 0.01 for index in range(20)]
    second_times = [0.3 + index * 0.01 for index in range(20)]
    times = [*first_times, *second_times]
    frequencies = [midi_to_hz(60)] * 20 + [midi_to_hz(64)] * 20

    locked = quantize_voiced_points(times, frequencies)

    assert locked[:20] == pytest.approx([midi_to_hz(60)] * 20)
    assert locked[20:] == pytest.approx([midi_to_hz(64)] * 20)


def test_quantization_rejects_invalid_points():
    with pytest.raises(ValueError):
        quantize_voiced_points([0.0], [])
    with pytest.raises(ValueError):
        quantize_voiced_points([0.0], [0.0])
    with pytest.raises(ValueError):
        quantize_voiced_points([0.1, 0.0], [220.0, 220.0])
