from __future__ import annotations

import math

import numpy as np

from AI.utils.numeric import clamp01

# Largest float32 value that is guaranteed not to exceed the documented 0.985
# limiter ceiling when compared in Python/float64. ``np.float32(0.985)`` itself
# is slightly larger (0.985000014...), which made exact limiter hits violate
# the public bound on some tests/platforms.
_LIMITER_CEILING = np.nextafter(np.float32(0.985), np.float32(0.0))


class StudioMicrophoneProcessor:

    def __init__(self, sample_rate: float, channels: int = 1):
        self.sample_rate = max(8_000.0, float(sample_rate))
        self.channels = max(1, int(channels))
        self._prev_x = np.zeros(self.channels, dtype=np.float32)
        self._hp_y = np.zeros(self.channels, dtype=np.float32)
        self._tone_low = np.zeros(self.channels, dtype=np.float32)
        self._gate_gain = 1.0
        self._compressor_gain = 1.0
        self._noise_floor = 0.003
        self._hp_r = math.exp(-2.0 * math.pi * 70.0 / self.sample_rate)
        self._tone_alpha = 1.0 - math.exp(-2.0 * math.pi * 2200.0 / self.sample_rate)

    def process(self, data, gain: float = 1.0, noise_suppression: float = 0.35):
        source = np.asarray(data, dtype=np.float32)
        if source.ndim == 1: source = source[:, None]
        if source.size == 0: return source.copy()
        if source.shape[1] != self.channels:
            self.channels = source.shape[1]
            self._prev_x = np.zeros(self.channels, dtype=np.float32)
            self._hp_y = np.zeros(self.channels, dtype=np.float32)
            self._tone_low = np.zeros(self.channels, dtype=np.float32)

        x = np.clip(source * float(gain), -1.5, 1.5)
        y = np.empty_like(x)
        for index in range(len(x)):
            current = x[index]
            hp = current - self._prev_x + self._hp_r * self._hp_y
            self._prev_x = current
            self._hp_y = hp
            self._tone_low += self._tone_alpha * (hp - self._tone_low)
            y[index] = hp * 0.94 + (hp - self._tone_low) * 0.16

        rms = float(np.sqrt(np.mean(np.square(y), dtype=np.float64)))
        if rms < self._noise_floor * 1.4: self._noise_floor = self._noise_floor * 0.995 + rms * 0.005
        threshold = max(0.0025, self._noise_floor * 2.4)
        if rms <= threshold:
            target_gate = 0.12 + 0.38 * (rms / threshold if threshold else 0.0)
        elif rms < threshold * 2.2:
            target_gate = 0.5 + 0.5 * (rms - threshold) / (threshold * 1.2)
        else:
            target_gate = 1.0
        strength = clamp01(noise_suppression)
        target_gate = 1.0 + (target_gate - 1.0) * strength
        gate_speed = 0.55 if target_gate > self._gate_gain else 0.18
        self._gate_gain += (target_gate - self._gate_gain) * gate_speed
        y *= self._gate_gain

        rms, threshold_comp = float(np.sqrt(np.mean(np.square(y), dtype=np.float64))), 0.16
        if rms > threshold_comp:
            compressed = threshold_comp * (rms / threshold_comp) ** (1.0 / 3.0)
            target_comp = compressed / max(rms, 1e-9)
        else:
            target_comp = 1.0
        comp_speed = 0.35 if target_comp < self._compressor_gain else 0.08
        self._compressor_gain += (target_comp - self._compressor_gain) * comp_speed
        y *= self._compressor_gain * 1.08

        y = np.tanh(y * 1.12) / np.tanh(1.12)
        return np.clip(y, -_LIMITER_CEILING, _LIMITER_CEILING).astype(np.float32, copy=False)


class MonitorEffectsChain:

    _SLOT_COUNT = 6
    _MAX_DELAY_SEC = 0.6

    def __init__(self, sample_rate: float):
        self.sample_rate = max(8_000.0, float(sample_rate))
        self._buffer_len = int(self.sample_rate * self._MAX_DELAY_SEC) + 1
        self._buffers = np.zeros((self._SLOT_COUNT, self._buffer_len), dtype=np.float32)
        self._write_pos = 0

    @staticmethod
    def _slots(reverb: float, echo: float, delay: float) -> tuple[tuple[float, float], ...]:
        reverb, echo, delay = clamp01(reverb), clamp01(echo), clamp01(delay)
        return (
            (0.055, 0.20 + reverb * 0.24 if reverb >= 0.01 else 0.0),
            (0.110, 0.14 + reverb * 0.18 if reverb >= 0.01 else 0.0),
            (0.170, 0.08 + reverb * 0.14 if reverb >= 0.01 else 0.0),
            (0.180, 0.18 + echo * 0.38 if echo >= 0.01 else 0.0),
            (0.360, 0.10 + echo * 0.22 if echo >= 0.01 else 0.0),
            (0.110 + delay * 0.39, 0.16 + delay * 0.34 if delay >= 0.01 else 0.0),
        )

    def process(self, samples: np.ndarray, reverb: float, echo: float, delay: float) -> np.ndarray:
        slots = self._slots(reverb, echo, delay)
        if not any(decay > 0.0 for _, decay in slots): return samples
        length = self._buffer_len
        offsets, decays, buffers, write_pos, out = [min(length - 1, max(1, int(delay_sec * self.sample_rate))) for delay_sec, _ in slots], [decay for _, decay in slots], self._buffers, self._write_pos, np.empty_like(samples)
        for index in range(len(samples)):
            dry = float(samples[index])
            wet = 0.0
            for slot in range(self._SLOT_COUNT):
                decay = decays[slot]
                if decay <= 0.0: continue
                read_pos = (write_pos - offsets[slot]) % length
                delayed = buffers[slot, read_pos]
                buffers[slot, write_pos] = dry + decay * delayed
                wet += decay * delayed
            out[index] = dry + wet
            write_pos = (write_pos + 1) % length
        self._write_pos = write_pos
        return out
