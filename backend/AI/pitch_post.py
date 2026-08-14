from __future__ import annotations

import math
import statistics
from pathlib import Path

import numpy as np

from .audio import load_mono
from .models import PitchFrame

# Harmonic tracking is needed on dense vocal stems, but transitions must become
# cheap at a real acoustic re-attack.  This keeps short melodic leaps while
# folding unsupported octave/harmonic detours back onto the lead trajectory.
PITCH_STABILIZER_VERSION = "fcpe-yin-consensus-v8-adaptive-analysis-audit"
_HARMONIC_SHIFTS = (0.0, -12.0, 12.0, -19.01955, 19.01955, -24.0, 24.0)
_SUBHARMONIC_INTERVALS = (12.0, 19.01955, 24.0)


def _normalized_periodicity(signal: np.ndarray, lag: int) -> float:
    """Normalized autocorrelation at one candidate period, 0..1."""
    lag = int(lag)
    if lag < 2 or signal.size <= lag + 8:
        return 0.0
    left = signal[:-lag].astype(np.float64, copy=False)
    right = signal[lag:].astype(np.float64, copy=False)
    left = left - float(np.mean(left))
    right = right - float(np.mean(right))
    denom = float(np.linalg.norm(left) * np.linalg.norm(right))
    if denom <= 1e-10:
        return 0.0
    return max(0.0, min(1.0, float(np.dot(left, right) / denom)))


def refine_pitch_confidence(
    frames: list[PitchFrame],
    audio: str | Path,
    *,
    sample_rate: int = 16000,
) -> list[PitchFrame]:
    """Replace fake FCPE confidence=1 with confidence measured from audio.

    Some TorchFCPE releases return only F0.  Treating every voiced value as
    confidence 1.0 makes backing vocals and harmonic mistakes indistinguishable
    from a clean lead.  We independently measure periodic support for the exact
    predicted F0 directly in the separated vocal waveform.  This does *not*
    rewrite pitch; it only tells downstream decoding how much to trust it.
    """
    if not frames:
        return []
    try:
        y, sr = load_mono(audio, sample_rate)
    except Exception:
        return list(frames)
    if y.size < 256:
        return list(frames)

    y = np.asarray(y, dtype=np.float32)
    # 50 ms gives several periods even for low male vocals while staying local
    # enough for attacks and fast melodic movement.
    half_window = max(192, int(round(sr * 0.025)))
    output: list[PitchFrame] = []
    raw_confidences = [float(f.confidence) for f in frames if f.voiced and f.frequency > 0]
    # Detect the exact problematic API case: essentially every voiced frame was
    # assigned confidence=1 because the model exposed no confidence tensor.
    fake_unity = (
        bool(raw_confidences)
        and sum(c >= 0.999 for c in raw_confidences) / len(raw_confidences) >= 0.97
    )

    for frame in frames:
        if not frame.voiced or frame.frequency <= 0:
            output.append(frame)
            continue
        center = int(round(frame.time * sr))
        start = max(0, center - half_window)
        end = min(len(y), center + half_window)
        window = y[start:end]
        lag = int(round(sr / max(1e-6, frame.frequency)))
        periodicity = _normalized_periodicity(window, lag)

        # Octave ambiguity check.  If twice the period explains the waveform much
        # better, the current F0 is likely a harmonic.  Lower confidence strongly
        # rather than silently changing the note here; the phrase decoder can
        # then choose using neighbouring evidence.
        lower_periodicity = _normalized_periodicity(window, lag * 2)
        if lower_periodicity > periodicity + 0.10:
            periodicity *= max(0.25, 1.0 - (lower_periodicity - periodicity) * 1.8)

        measured = max(0.0, min(1.0, periodicity))
        if fake_unity:
            confidence = measured
        else:
            # If FCPE supplies genuine confidence, require agreement between the
            # network and waveform periodicity instead of replacing either one.
            confidence = math.sqrt(max(0.0, min(1.0, frame.confidence)) * measured)
        voiced = confidence >= 0.16
        output.append(
            PitchFrame(
                frame.time,
                frame.frequency if voiced else 0.0,
                confidence if voiced else 0.0,
                voiced,
                frame.energy,
            )
        )
    return output


def fuse_pitch_with_yin(
    frames: list[PitchFrame],
    audio: str | Path,
    *,
    sample_rate: int = 16000,
    fmin_hz: float = 55.0,
    fmax_hz: float = 1400.0,
) -> list[PitchFrame]:
    """Fuse FCPE with an independent fast YIN contour on the same 10 ms grid.

    FCPE is excellent on clean monophonic passages but dense sung doubles can make
    it jump to a harmonic. YIN fails differently. We keep both as candidates and
    select a phrase-local trajectory using direct waveform periodicity plus a weak
    continuity prior. State is reset whenever neither estimator has acoustic support,
    so one bad register decision cannot poison the rest of the song.
    """
    if not frames:
        return []
    try:
        import librosa

        y, sr = load_mono(audio, sample_rate)
    except Exception:
        return list(frames)
    if y.size < 2048:
        return list(frames)
    y = np.asarray(y, dtype=np.float32)
    gaps = [
        b.time - a.time
        for a, b in zip(frames, frames[1:], strict=False)
        if 0 < b.time - a.time < 0.05
    ]
    step = statistics.median(gaps) if gaps else 0.01
    hop = max(64, int(round(sr * step)))
    try:
        yin = librosa.yin(
            y,
            fmin=float(fmin_hz),
            fmax=float(fmax_hz),
            sr=sr,
            frame_length=2048,
            hop_length=hop,
            trough_threshold=0.10,
            center=True,
        )
    except Exception:
        return list(frames)

    half_window = max(256, int(round(sr * 0.025)))

    def fcpe_run_strength(index: int) -> float:
        frame = frames[index]
        if not frame.voiced or frame.frequency <= 0:
            return 0.0
        center_midi = _midi(frame.frequency)
        neighbourhood = frames[max(0, index - 6) : min(len(frames), index + 7)]
        voiced = [item for item in neighbourhood if item.voiced and item.frequency > 0]
        if len(voiced) < 4:
            return 0.0
        stable = [item for item in voiced if abs(_midi(item.frequency) - center_midi) <= 0.75]
        continuity = len(stable) / len(voiced)
        confidence = statistics.median(float(item.confidence) for item in stable) if stable else 0.0
        return continuity * max(0.0, min(1.0, confidence))

    def protected_subharmonic(index: int, candidate_midi: float, evidence: float) -> bool:
        frame = frames[index]
        if not frame.voiced or frame.frequency <= 0:
            return False
        interval = _midi(frame.frequency) - candidate_midi
        if not any(abs(interval - harmonic) <= 0.65 for harmonic in _SUBHARMONIC_INTERVALS):
            return False
        run_strength = fcpe_run_strength(index)
        if run_strength < 0.32:
            return False
        fcpe_evidence = support(index, float(frame.frequency)) + 0.06
        # A stable FCPE trajectory is only displaced by an octave-related YIN
        # candidate when the waveform support wins decisively. Real octave
        # transitions emitted by FCPE have interval=0 and are unaffected.
        return evidence < fcpe_evidence + 0.16 + 0.10 * run_strength

    def support(index: int, hz: float) -> float:
        if not np.isfinite(hz) or hz < float(fmin_hz) or hz > float(fmax_hz):
            return 0.0
        center = int(round(frames[index].time * sr))
        start = max(0, center - half_window)
        end = min(len(y), center + half_window)
        window = y[start:end]
        lag = int(round(sr / hz))
        return _normalized_periodicity(window, lag)

    rows: list[list[tuple[float, float, float]]] = []
    energies = [max(0.0, float(f.energy)) for f in frames]
    attacks: list[float] = []
    for i, energy in enumerate(energies):
        history = energies[max(0, i - 8) : i]
        baseline = statistics.median(history) if history else energy
        ratio = (energy + 1e-7) / (baseline + 1e-7)
        attacks.append(max(0.0, min(1.0, (ratio - 1.15) / 0.95)))

    for i, frame in enumerate(frames):
        yi = min(len(yin) - 1, max(0, int(round(frame.time * sr / hop))))
        sources = []
        if frame.voiced and frame.frequency > 0:
            sources.append((float(frame.frequency), 0.06))
        yh = float(yin[yi]) if 0 <= yi < len(yin) and np.isfinite(yin[yi]) else 0.0
        if yh > 0:
            sources.append((yh, 0.0))
        candidates: list[tuple[float, float, float]] = []
        for hz, source_bonus in sources:
            base_support = support(i, hz)
            if base_support >= 0.17:
                m = _midi(hz)
                evidence = base_support + source_bonus
                if not protected_subharmonic(i, m, evidence):
                    candidates.append((m, evidence, hz))
            # The most common dense-vocal failure is selecting the 2nd harmonic.
            lower = hz / 2.0
            if lower >= float(fmin_hz):
                lower_support = support(i, lower)
                if lower_support >= max(0.22, base_support + 0.055):
                    lower_midi = _midi(lower)
                    evidence = lower_support - 0.01
                    if not protected_subharmonic(i, lower_midi, evidence):
                        candidates.append((lower_midi, evidence, lower))
        # Deduplicate nearly identical FCPE/YIN candidates.
        candidates.sort(key=lambda item: item[1], reverse=True)
        unique: list[tuple[float, float, float]] = []
        for item in candidates:
            if not any(abs(item[0] - other[0]) < 0.30 for other in unique):
                unique.append(item)
        rows.append(unique[:4])

    result: list[PitchFrame] = [PitchFrame(f.time, 0.0, 0.0, False, f.energy) for f in frames]
    i = 0
    while i < len(frames):
        if not rows[i]:
            i += 1
            continue
        j = i
        # Phrase-local decode. Hard cap prevents register history from spanning
        # a long dense chorus even if the tracker never emits silence.
        while j < len(frames) and rows[j] and j - i < max(120, int(round(8.0 / step))):
            j += 1
        costs: list[float] = []
        back: list[list[int]] = []
        for k in range(i, j):
            current = rows[k]
            current_costs: list[float] = []
            current_back: list[int] = []
            for midi_value, obs, _hz_value in current:
                emission = -3.4 * obs
                if not costs:
                    current_costs.append(emission)
                    current_back.append(-1)
                    continue
                best = float("inf")
                best_index = 0
                for pi, previous_cost in enumerate(costs):
                    previous_midi = rows[k - 1][pi][0]
                    delta = abs(midi_value - previous_midi)
                    transition = (
                        0.045 * delta + 0.30 * max(0.0, delta - 2.0) + 0.72 * max(0.0, delta - 7.0)
                    ) * (1.0 - 0.84 * attacks[k])
                    value = previous_cost + transition + emission
                    if value < best:
                        best = value
                        best_index = pi
                current_costs.append(best)
                current_back.append(best_index)
            costs = current_costs
            back.append(current_back)
        state = min(range(len(costs)), key=costs.__getitem__)
        chosen: list[int] = []
        for k in range(j - 1, i - 1, -1):
            chosen.append(state)
            state = back[k - i][state]
        chosen.reverse()
        for offset, state in enumerate(chosen):
            k = i + offset
            midi_value, obs, hz_value = rows[k][state]
            confidence = max(0.0, min(1.0, obs))
            result[k] = PitchFrame(
                frames[k].time,
                float(hz_value),
                confidence,
                confidence >= 0.17,
                frames[k].energy,
            )
        i = max(i + 1, j)
    return result


def _midi(hz: float) -> float:
    return 69.0 + 12.0 * math.log2(hz / 440.0)


def _hz(midi: float) -> float:
    return 440.0 * 2.0 ** ((midi - 69.0) / 12.0)


def _frame_step(frames: list[PitchFrame]) -> float:
    gaps = [
        b.time - a.time
        for a, b in zip(frames, frames[1:], strict=False)
        if 0 < b.time - a.time <= 0.08
    ]
    return max(0.005, min(0.04, statistics.median(gaps) if gaps else 0.01))


def _attack_strength(run: list[PitchFrame], index: int) -> float:
    """Return 0..1 re-attack evidence from the already-computed vocal energy.

    A true new sung note often starts with renewed energy, while a tracker jump
    to an octave/harmonic usually happens inside one continuous voiced sound.
    Only strong relative rises count; ordinary vibrato/dynamics stay near zero.
    """
    if index <= 0:
        return 0.0
    current = max(0.0, run[index].energy)
    lo = max(0, index - 5)
    history = [max(0.0, run[i].energy) for i in range(lo, index)]
    baseline = statistics.median(history)
    if baseline <= 1e-8:
        return 1.0 if current > 1e-5 else 0.0
    ratio = current / baseline
    # No discount below ~1.25x; full attack discount at ~2.1x.
    return max(0.0, min(1.0, (ratio - 1.25) / 0.85))


def _transition_cost(left: float, right: float, attack: float) -> float:
    distance = min(24.0, abs(right - left))
    base = 0.12 * distance + 0.035 * distance * distance
    # At a strong acoustic attack, a real large melodic leap should be allowed.
    # Still keep a small cost so noise does not make the path completely free.
    scale = 1.0 - 0.88 * max(0.0, min(1.0, attack))
    return base * max(0.12, scale)


def _shift_cost(shift: float, confidence: float) -> float:
    if abs(shift) < 0.01:
        return 0.0
    magnitude = abs(shift)
    base = 1.0 if magnitude < 13 else 1.25 if magnitude < 20 else 1.5
    # Never treat fallback confidence as absolute truth.  Confidence only adds a
    # modest source prior; sustained raw notes still win because a correction
    # pays this emission cost on every frame.
    trust = max(0.0, min(1.0, confidence))
    return base * (0.78 + 0.28 * trust)


def _stabilize_voiced_run(run: list[PitchFrame]) -> list[PitchFrame]:
    if len(run) < 3:
        return list(run)

    candidates: list[list[tuple[float, float]]] = []
    for frame in run:
        raw = _midi(frame.frequency)
        values = [
            (raw + shift, shift) for shift in _HARMONIC_SHIFTS if 28.0 <= raw + shift <= 100.0
        ]
        candidates.append(values or [(raw, 0.0)])

    attacks = [_attack_strength(run, index) for index in range(len(run))]
    costs = [_shift_cost(shift, run[0].confidence) for _, shift in candidates[0]]
    parents: list[list[int]] = [[-1] * len(candidates[0])]

    for index in range(1, len(run)):
        next_costs: list[float] = []
        next_parents: list[int] = []
        attack = attacks[index]
        for value, shift in candidates[index]:
            choices = [
                cost + _transition_cost(previous_value, value, attack)
                for cost, (previous_value, _) in zip(costs, candidates[index - 1], strict=False)
            ]
            parent = min(range(len(choices)), key=choices.__getitem__)
            next_costs.append(choices[parent] + _shift_cost(shift, run[index].confidence))
            next_parents.append(parent)
        costs = next_costs
        parents.append(next_parents)

    selected = [0] * len(run)
    selected[-1] = min(range(len(costs)), key=costs.__getitem__)
    for index in range(len(run) - 1, 0, -1):
        selected[index - 1] = parents[index][selected[index]]

    output: list[PitchFrame] = []
    for frame, options, option_index in zip(run, candidates, selected, strict=False):
        midi, shift = options[option_index]
        output.append(
            PitchFrame(
                frame.time,
                _hz(midi),
                frame.confidence * (0.97 if abs(shift) > 0.01 else 1.0),
                frame.voiced,
                frame.energy,
            )
        )
    return output


def _stabilize_harmonics(frames: list[PitchFrame]) -> list[PitchFrame]:
    output = list(frames)
    step = _frame_step(frames)
    run_gap = step * 3.5
    index = 0
    while index < len(frames):
        frame = frames[index]
        if not frame.voiced or frame.frequency <= 0:
            index += 1
            continue
        end = index + 1
        while (
            end < len(frames)
            and frames[end].voiced
            and frames[end].frequency > 0
            and frames[end].time - frames[end - 1].time <= run_gap
        ):
            end += 1
        output[index:end] = _stabilize_voiced_run(frames[index:end])
        index = end
    return output


def _repair_single_frame_holes(frames: list[PitchFrame]) -> list[PitchFrame]:
    out = list(frames)
    step = _frame_step(out)
    for index in range(1, len(out) - 1):
        prev, cur, nxt = out[index - 1], out[index], out[index + 1]
        if cur.voiced or not prev.voiced or not nxt.voiced:
            continue
        if nxt.time - prev.time > step * 2.8:
            continue
        if abs(_midi(prev.frequency) - _midi(nxt.frequency)) > 0.55:
            continue
        out[index] = PitchFrame(
            cur.time,
            math.sqrt(prev.frequency * nxt.frequency),
            min(prev.confidence, nxt.confidence) * 0.84,
            True,
            cur.energy,
        )
    return out


def stabilize_pitch(frames: list[PitchFrame], max_octave_jump=10.5) -> list[PitchFrame]:
    """Denoise harmonic/octave tracker errors without flattening real attacks.

    `max_octave_jump` remains for API compatibility.  The decoder works on
    absolute harmonic candidates and uses energy re-attacks to relax continuity
    exactly where a genuine new sung note is most plausible.
    """
    del max_octave_jump
    if len(frames) < 3:
        return list(frames)
    return _repair_single_frame_holes(_stabilize_harmonics(frames))
