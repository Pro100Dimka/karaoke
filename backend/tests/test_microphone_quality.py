import numpy as np

from app.services.microphone_quality import MonitorEffectsChain, StudioMicrophoneProcessor


def test_studio_processor_suppresses_quiet_noise_and_limits_peaks():
    processor = StudioMicrophoneProcessor(48_000, 1)
    noise = np.full((256, 1), 0.001, dtype=np.float32)
    for _ in range(12):
        quiet = processor.process(noise)
    assert float(np.sqrt(np.mean(quiet**2))) < 0.001

    loud = np.array([[1.4], [-1.4]] * 128, dtype=np.float32)
    processed = processor.process(loud)
    assert processed.shape == loud.shape
    assert np.max(np.abs(processed)) <= 0.985
    assert np.isfinite(processed).all()


def test_studio_processor_keeps_normal_voice_audible_and_stateful():
    processor = StudioMicrophoneProcessor(48_000, 1)
    time = np.arange(480, dtype=np.float32) / 48_000
    voice = (0.18 * np.sin(2 * np.pi * 220 * time))[:, None]
    first = processor.process(voice)
    second = processor.process(voice)
    assert np.sqrt(np.mean(second**2)) > 0.03
    assert not np.allclose(first, voice)
    assert np.isfinite(second).all()


def test_monitor_effects_chain_is_a_passthrough_when_everything_is_off():
    chain = MonitorEffectsChain(48_000)
    impulse = np.zeros(4_000, dtype=np.float32)
    impulse[0] = 1.0
    out = chain.process(impulse, reverb=0.0, echo=0.0, delay=0.0)
    assert np.array_equal(out, impulse)


def test_monitor_effects_chain_adds_a_decaying_echo_after_the_tap_delay():
    chain = MonitorEffectsChain(48_000)
    impulse = np.zeros(48_000, dtype=np.float32)
    impulse[0] = 1.0
    out = chain.process(impulse, reverb=0.0, echo=1.0, delay=0.0)
    assert np.isfinite(out).all()
    # Nothing should come back before the first echo tap's delay.
    assert np.allclose(out[1 : int(0.179 * 48_000)], 0.0)
    # A decaying echo should land at each configured echo tap.
    first_tap = int(0.180 * 48_000)
    second_tap = int(0.360 * 48_000)
    assert out[first_tap] > 0.0
    assert out[second_tap] > 0.0
    # The repeats keep decaying rather than sustaining or growing -- by a
    # second out (well past both taps) it should be far below the first echo.
    assert abs(out[-1]) < out[first_tap] * 0.05


def test_monitor_effects_chain_stays_bounded_with_every_effect_maxed(monkeypatch):
    chain = MonitorEffectsChain(48_000)
    # Sustained loud input with every effect at maximum is the worst case for
    # a feedback delay network; each tap's own decay must keep it from
    # diverging even though several taps are active at once.
    loud = np.full(96_000, 0.9, dtype=np.float32)
    out = chain.process(loud, reverb=1.0, echo=1.0, delay=1.0)
    assert np.isfinite(out).all()
    assert np.max(np.abs(out)) < 10.0
