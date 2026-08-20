// The one microphone "studio channel strip" used everywhere the app applies
// always-on cleanup to a mic signal in the browser (online room self-monitor,
// online room outgoing-to-peers stream). It mirrors the backend's native
// StudioMicrophoneProcessor (backend/app/services/microphone_quality.py) --
// highpass to remove sub-vocal rumble, a touch of presence/air, gentle
// compression to keep levels even, and a soft limiter instead of the harsh
// digital clipping a raw passthrough would produce -- so the mic sounds the
// same regardless of which code path is routing it. Karaoke's own "hear
// yourself" monitoring bypasses the browser entirely (it runs through the
// same native processor directly, see backend/app/services/monitor_worker.py),
// so this module only needs to cover the browser-side paths.

const SOFT_LIMITER_DRIVE = 1.12;
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

export function buildNoiseGateCurve(strength = 0.35) {
  const samples = 4096;
  const curve = new Float32Array(samples);
  const threshold = 0.0015 + clamp01(strength) * 0.012;
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    const magnitude = Math.abs(x);
    const openness = magnitude >= threshold ? 1 : (magnitude / threshold) ** 2;
    curve[index] = x * openness;
  }
  return curve;
}

export function buildSoftLimiterCurve(drive = SOFT_LIMITER_DRIVE) {
  const samples = 1024;
  const curve = new Float32Array(samples);
  const normalizer = Math.tanh(drive);
  for (let index = 0; index < samples; index += 1) {
    const x = (index / (samples - 1)) * 2 - 1;
    curve[index] = Math.tanh(x * drive) / normalizer;
  }
  return curve;
}

export function connectMicrophoneChannelStrip(
  context,
  source,
  destination,
  { noiseSuppression = 0.35 } = {}
) {
  const highpass = context.createBiquadFilter();
  highpass.type = "highpass";
  highpass.frequency.value = 70;

  const presence = context.createBiquadFilter();
  presence.type = "highshelf";
  presence.frequency.value = 2200;
  presence.gain.value = 2.5;

  const noiseGate = context.createWaveShaper();
  noiseGate.curve = buildNoiseGateCurve(noiseSuppression);
  noiseGate.oversample = "2x";

  const compressor = context.createDynamicsCompressor();
  compressor.threshold.value = -16;
  compressor.knee.value = 6;
  compressor.ratio.value = 3;
  compressor.attack.value = 0.01;
  compressor.release.value = 0.15;

  const makeup = context.createGain();
  makeup.gain.value = 1.08;

  const limiter = context.createWaveShaper();
  limiter.curve = buildSoftLimiterCurve();
  limiter.oversample = "2x";

  source.connect(highpass);
  highpass.connect(noiseGate);
  noiseGate.connect(presence);
  presence.connect(compressor);
  compressor.connect(makeup);
  makeup.connect(limiter);
  limiter.connect(destination);

  return {
    highpass,
    noiseGate,
    presence,
    compressor,
    makeup,
    limiter,
    setNoiseSuppression(value) {
      noiseGate.curve = buildNoiseGateCurve(value);
    }
  };
}
