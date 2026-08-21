import numpy as np

from app.services.microphone_quality import MonitorEffectsChain, StudioMicrophoneProcessor


def test_studio_processor_suppresses_quiet_noise_and_limits_peaks():
    processor, noise = StudioMicrophoneProcessor(48000, 1), np.full((256, 1), 0.001, dtype=np.float32)
    for _ in range(12): quiet = processor.process(noise)
    assert float(np.sqrt(np.mean(quiet**2))) < 0.001

    loud = np.array([[1.4], [-1.4]] * 128, dtype=np.float32)
    processed = processor.process(loud)
    assert (processed.shape == loud.shape) and (np.max(np.abs(processed)) <= 0.985) and (np.isfinite(processed).all())


def test_studio_processor_keeps_normal_voice_audible_and_stateful():
    processor, time = StudioMicrophoneProcessor(48000, 1), np.arange(480, dtype=np.float32) / 48000
    voice = (0.18 * np.sin(2 * np.pi * 220 * time))[:, None]
    first, second = processor.process(voice), processor.process(voice)
    assert (np.sqrt(np.mean(second ** 2)) > 0.03) and (not np.allclose(first, voice)) and (np.isfinite(second).all())


def test_full_noise_suppression_has_more_range_without_muting_normal_voice():
    noise = np.full((512, 1), 0.004, dtype=np.float32)
    weak, strong = StudioMicrophoneProcessor(48000, 1), StudioMicrophoneProcessor(48000, 1)
    for _ in range(8):
        weak_result = weak.process(noise, noise_suppression=0.0)
        strong_result = strong.process(noise, noise_suppression=1.0)
    assert np.sqrt(np.mean(strong_result**2)) < np.sqrt(np.mean(weak_result**2)) * 0.35

    time = np.arange(480, dtype=np.float32) / 48000
    voice = (0.18 * np.sin(2 * np.pi * 220 * time))[:, None]
    assert np.sqrt(np.mean(strong.process(voice, noise_suppression=1.0) ** 2)) > 0.03


def test_monitor_effects_chain_is_a_passthrough_when_everything_is_off():
    chain, impulse = MonitorEffectsChain(48000), np.zeros(4000, dtype=np.float32)
    impulse[0] = 1.0
    out = chain.process(impulse, reverb=0.0, echo=0.0, delay=0.0)
    assert np.array_equal(out, impulse)


def test_monitor_effects_chain_adds_a_decaying_echo_after_the_tap_delay():
    chain, impulse = MonitorEffectsChain(48000), np.zeros(48000, dtype=np.float32)
    impulse[0] = 1.0
    out = chain.process(impulse, reverb=0.0, echo=1.0, delay=0.0)
    assert (np.isfinite(out).all()) and (np.allclose(out[1:int(0.179 * 48000)], 0.0))
    first_tap, second_tap = int(0.18 * 48000), int(0.36 * 48000)
    assert (out[first_tap] > 0.0) and (out[second_tap] > 0.0) and (abs(out[-1]) < out[first_tap] * 0.05)


def test_monitor_effects_chain_stays_bounded_with_every_effect_maxed(monkeypatch):
    chain, loud = MonitorEffectsChain(48000), np.full(96000, 0.9, dtype=np.float32)
    out = chain.process(loud, reverb=1.0, echo=1.0, delay=1.0)
    assert (np.isfinite(out).all()) and (np.max(np.abs(out)) < 10.0)


def test_monitor_effect_amounts_are_continuous_and_disabled_slots_forget_stale_audio():
    low = MonitorEffectsChain._slots(0.01, 0.01, 0.01)
    high = MonitorEffectsChain._slots(0.02, 0.02, 0.02)
    assert all(0 < left[1] < right[1] for left, right in zip(low, high, strict=True))

    chain = MonitorEffectsChain(8000)
    impulse = np.zeros(100, dtype=np.float32)
    impulse[0] = 1.0
    chain.process(impulse, reverb=0.0, echo=1.0, delay=0.0)
    chain.process(np.zeros(100, dtype=np.float32), reverb=0.0, echo=0.0, delay=0.0)
    restarted = chain.process(
        np.zeros(4000, dtype=np.float32), reverb=0.0, echo=1.0, delay=0.0
    )
    assert np.count_nonzero(restarted) == 0
