import { createLevelMeter } from "./levelMeter";

const CURVES = { limiter: 1024 };
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function curve(length, transform) {
  return Float32Array.from({ length }, (_, index) => transform((index / (length - 1)) * 2 - 1));
}

export function buildSoftLimiterCurve(drive = 1.03) {
  const limit = Math.tanh(drive);
  return curve(CURVES.limiter, (sample) => Math.tanh(sample * drive) / limit);
}

const assign = (node, values) => {
  for (const [key, value] of Object.entries(values)) node[key].value = value;
  return node;
};

export function connectMicrophoneChannelStrip(
  context,
  source,
  destination,
  { noiseSuppression = 0.35, realtime = false } = {}
) {
  const highpass = assign(context.createBiquadFilter(), { frequency: 70 });
  highpass.type = "highpass";
  const meter = createLevelMeter(context, { smoothingTimeConstant: 0.45 });
  const analyser = meter?.analyser;
  const noiseGate = assign(context.createGain(), { gain: 1 });
  // Boosting presence before the compressor makes the compressor's envelope
  // detector react harder to exactly the frequencies (~2-8kHz) where hiss and
  // sibilance live, and the following limiter then has to soft-clip that
  // already-brightened, already-compressed signal -- a combination reported
  // to sound harsh/hissy to listeners on the receiving end. Trading some
  // presence/"clarity" for a cleaner signal here.
  const presence = assign(context.createBiquadFilter(), { frequency: 2200, gain: 1.2 });
  presence.type = "highshelf";
  const compressor = assign(context.createDynamicsCompressor(), {
    threshold: -16,
    knee: 6,
    ratio: 3,
    attack: 0.01,
    release: 0.15
  });
  const makeup = assign(context.createGain(), { gain: 1.04 });
  const limiter = context.createWaveShaper();
  Object.assign(limiter, {
    curve: buildSoftLimiterCurve(),
    // Oversampling is useful for an offline/final recording, but it adds
    // filtering delay to the live duet path. The realtime graph keeps the
    // limiter and all user-facing processing without that extra buffer.
    oversample: realtime ? "none" : "2x"
  });
  // DynamicsCompressorNode has a fixed look-ahead delay. In a live room the
  // soft limiter already protects peaks, so bypass only that redundant node;
  // high-pass, noise gate, tone, gain and limiter remain active.
  const chain = realtime
    ? [highpass, analyser, noiseGate, presence, makeup, limiter, destination]
    : [highpass, analyser, noiseGate, presence, compressor, makeup, limiter, destination];
  chain.filter(Boolean).reduce((node, next) => node.connect(next), source);
  let suppression = clamp01(noiseSuppression);
  let lastVoiceAt = 0;
  let timer = null;
  if (analyser) {
    const updateGate = () => {
      const rms = meter.read();
      const now = Date.now();
      const threshold = 0.0035 + suppression * 0.008;
      if (rms >= threshold) lastVoiceAt = now;
      const held = now - lastVoiceAt < 140;
      const openness = Math.min(1, rms / threshold);
      const target =
        suppression === 0 || held ? 1 : Math.max(0.12, 1 - suppression * 0.88 * (1 - openness));
      if (typeof noiseGate.gain.setTargetAtTime === "function") {
        noiseGate.gain.setTargetAtTime(
          target,
          context.currentTime,
          target > noiseGate.gain.value ? 0.008 : 0.12
        );
      } else noiseGate.gain.value = target;
    };
    timer = globalThis.setInterval(updateGate, 24);
    timer?.unref?.();
  }
  return {
    highpass,
    analyser,
    noiseGate,
    presence,
    compressor,
    makeup,
    limiter,
    setNoiseSuppression: (value) => {
      suppression = clamp01(value);
    },
    close: () => timer && globalThis.clearInterval(timer)
  };
}
