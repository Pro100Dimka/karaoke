// Quantum Fields audio-analysis math adapted to the FFT values already exposed by A&D Voice.
// It intentionally does NOT create another AudioContext / MediaElementAudioSourceNode.

const BAND_COUNT = 18;

const average = (values, from, to) => {
  let sum = 0;
  let count = 0;
  for (let i = from; i < to && i < values.length; i += 1) {
    sum += values[i];
    count += 1;
  }
  return count ? sum / count : 0;
};

export function createQftAudioReader({
  bassGateEnabled = false,
  bassGateThreshold = 0.12,
  bassGateAttack = 0.35,
  bassGateRelease = 0.08,
  bassGateRatio = 2,
  onsetSensitivity = 1,
  onsetDecay = 0.92
} = {}) {
  const state = {
    previous: new Float32Array(BAND_COUNT),
    peakHistory: [],
    onsetHistory: [],
    beatThreshold: 0.15,
    beatDecay: 0.93,
    beatEnergy: 0,
    lastBeatTime: 0,
    gate: {
      isOpen: false,
      envelope: 0,
      holdTime: 0,
      noiseFloor: 0.05,
      calibrationSamples: [],
      isCalibrating: true,
      calibrationFrames: 30
    }
  };

  const applyBassGate = (rawValue) => {
    if (!bassGateEnabled) return rawValue;
    const { gate } = state;
    if (gate.isCalibrating) {
      gate.calibrationSamples.push(rawValue);
      if (gate.calibrationSamples.length >= gate.calibrationFrames) {
        const sorted = [...gate.calibrationSamples].sort((a, b) => a - b);
        const n = Math.max(1, Math.floor(sorted.length * 0.2));
        gate.noiseFloor = sorted.slice(0, n).reduce((a, b) => a + b, 0) / n;
        gate.isCalibrating = false;
      }
    }
    const effectiveThreshold = Math.max(bassGateThreshold, gate.noiseFloor * 1.5);
    if (rawValue > effectiveThreshold) {
      gate.isOpen = true;
      gate.holdTime = 10;
    } else if (rawValue < effectiveThreshold * 0.7 && gate.holdTime <= 0) {
      gate.isOpen = false;
    }
    if (gate.holdTime > 0) gate.holdTime -= 1;
    gate.envelope +=
      ((gate.isOpen ? 1 : 0) - gate.envelope) * (gate.isOpen ? bassGateAttack : bassGateRelease);
    let output = rawValue;
    if (gate.isOpen && rawValue > effectiveThreshold) {
      output = effectiveThreshold + (rawValue - effectiveThreshold) / bassGateRatio;
    }
    return output * gate.envelope;
  };

  return function readQftAudio() {
    const styles = getComputedStyle(document.documentElement);
    const get = (name) => Math.max(0, Number.parseFloat(styles.getPropertyValue(name)) || 0);
    const spectrum = Array.from({ length: BAND_COUNT }, (_, i) =>
      Math.min(1, get(`--radio-band-${i}`))
    );
    const cssBass = Math.min(1, get("--radio-bass"));

    // Mapping of the app's 18 analyser bands into the same seven logical regions QFT uses.
    const bands = {
      subBass: Math.max(cssBass, average(spectrum, 0, 2)),
      bass: Math.max(cssBass, average(spectrum, 1, 4)),
      lowMid: average(spectrum, 3, 6),
      mid: average(spectrum, 5, 11),
      highMid: average(spectrum, 10, 13),
      high: average(spectrum, 12, 17),
      ultraHigh: average(spectrum, 16, 18)
    };

    const gatedBands = {
      ...bands,
      subBass: applyBassGate(bands.subBass),
      bass: applyBassGate(bands.bass),
      lowMid: applyBassGate(bands.lowMid)
    };

    let totalEnergy = 0;
    let weightedFreqSum = 0;
    let flux = 0;
    for (let i = 0; i < spectrum.length; i += 1) {
      const current = spectrum[i];
      totalEnergy += current;
      weightedFreqSum += current * i;
      const diff = current - state.previous[i];
      if (diff > 0) flux += diff * diff;
      state.previous[i] = current;
    }

    const spectralCentroid = totalEnergy > 0 ? weightedFreqSum / totalEnergy / spectrum.length : 0;
    const spectralFlux = Math.sqrt(flux / spectrum.length);

    const currentEnergy = gatedBands.bass * 0.6 + gatedBands.subBass * 0.4;
    state.peakHistory.push(currentEnergy);
    if (state.peakHistory.length > 50) state.peakHistory.shift();
    const avgEnergy =
      state.peakHistory.reduce((a, b) => a + b, 0) / Math.max(1, state.peakHistory.length);
    const variance =
      state.peakHistory.reduce((a, b) => a + (b - avgEnergy) ** 2, 0) /
      Math.max(1, state.peakHistory.length);
    const dynamicThreshold = avgEnergy + Math.sqrt(variance) * 1.8;
    const now = performance.now();
    if (
      currentEnergy > dynamicThreshold &&
      currentEnergy > state.beatThreshold &&
      now - state.lastBeatTime > 120
    ) {
      state.beatEnergy = 1;
      state.lastBeatTime = now;
    }
    state.beatEnergy *= state.beatDecay;

    state.onsetHistory.push(spectralFlux);
    if (state.onsetHistory.length > 8) state.onsetHistory.shift();
    const recent = state.onsetHistory.slice(-4);
    const older = state.onsetHistory.slice(0, 4);
    const recentAvg = recent.reduce((a, b) => a + b, 0) / Math.max(1, recent.length);
    const olderAvg = older.reduce((a, b) => a + b, 0) / Math.max(1, older.length);
    const onsetDelta = (recentAvg - olderAvg) * onsetSensitivity;
    const onsetDetected = onsetDelta > 0.015 && now - state.lastBeatTime > 50;
    const previousOnset = state.onsetEnergy || 0;
    state.onsetEnergy = onsetDetected ? 1 : previousOnset * onsetDecay;

    return {
      active: spectrum.some((v) => v > 0.002) || cssBass > 0.002,
      bands,
      gatedBands,
      beatEnergy: state.beatEnergy,
      spectralCentroid,
      spectralFlux,
      onsetEnergy: state.onsetEnergy
    };
  };
}
