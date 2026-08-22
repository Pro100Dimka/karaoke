const CURVES = { gate: 4096, limiter: 1024 };
const clamp01 = (value) => Math.max(0, Math.min(1, Number(value) || 0));

function curve(length, transform) {
  return Float32Array.from({ length }, (_, index) => transform((index / (length - 1)) * 2 - 1));
}

export function buildNoiseGateCurve(strength = 0.35) {
  const threshold = 0.0015 + clamp01(strength) * 0.018;
  return curve(CURVES.gate, (sample) => {
    const magnitude = Math.abs(sample);
    return sample * (magnitude >= threshold ? 1 : (magnitude / threshold) ** 2);
  });
}

export function buildSoftLimiterCurve(drive = 1.12) {
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
  { noiseSuppression = 0.35 } = {}
) {
  const highpass = assign(context.createBiquadFilter(), { frequency: 70 });
  highpass.type = "highpass";
  const noiseGate = context.createWaveShaper();
  const presence = assign(context.createBiquadFilter(), { frequency: 2200, gain: 2.5 });
  presence.type = "highshelf";
  const compressor = assign(context.createDynamicsCompressor(), {
    threshold: -16,
    knee: 6,
    ratio: 3,
    attack: 0.01,
    release: 0.15
  });
  const makeup = assign(context.createGain(), { gain: 1.08 });
  const limiter = context.createWaveShaper();
  Object.assign(noiseGate, { curve: buildNoiseGateCurve(noiseSuppression), oversample: "2x" });
  Object.assign(limiter, { curve: buildSoftLimiterCurve(), oversample: "2x" });
  [highpass, noiseGate, presence, compressor, makeup, limiter, destination].reduce(
    (node, next) => node.connect(next),
    source
  );
  return {
    highpass,
    noiseGate,
    presence,
    compressor,
    makeup,
    limiter,
    setNoiseSuppression: (value) => {
      noiseGate.curve = buildNoiseGateCurve(value);
    }
  };
}
