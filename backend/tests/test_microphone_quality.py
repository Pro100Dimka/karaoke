import numpy as np

from app.services.microphone_quality import StudioMicrophoneProcessor


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
