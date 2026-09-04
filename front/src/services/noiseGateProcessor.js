// Sample-accurate port of microphoneChannelStrip.js's noise gate: the same
// threshold/hold/openness math, previously driven by a main-thread
// setInterval(24) reading an AnalyserNode's RMS. A busy renderer (heavy
// React work, GC pauses) could delay that timer, which meant the gate could
// open/close late or "pump" audibly under load -- a realtime audio thread
// has no such exposure.
class NoiseGateProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.suppression = 0.35;
    this.envelope = 0;
    this.gain = 1;
    this.lastVoiceAt = 0;
    this.port.onmessage = ({ data }) => {
      if (typeof data?.suppression === "number")
        this.suppression = Math.max(0, Math.min(1, data.suppression));
    };
  }

  process(inputs, outputs) {
    const input = inputs[0]?.[0];
    const output = outputs[0]?.[0];
    if (!output) return true;
    const threshold = 0.0035 + this.suppression * 0.008;
    for (let index = 0; index < output.length; index += 1) {
      const sample = input ? input[index] : 0;
      // A cheap one-pole envelope follower in place of the AnalyserNode's
      // smoothed RMS read -- close enough for a threshold decision, which is
      // all this ever drives.
      this.envelope += (Math.abs(sample) - this.envelope) * 0.05;
      if (this.envelope >= threshold) this.lastVoiceAt = currentTime;
      const held = currentTime - this.lastVoiceAt < 0.14;
      const openness = Math.min(1, this.envelope / threshold);
      const target =
        this.suppression === 0 || held
          ? 1
          : Math.max(0.12, 1 - this.suppression * 0.88 * (1 - openness));
      // Exponential approach with the same two time constants (fast open,
      // slow close) as the original setTargetAtTime calls, applied per
      // sample instead of every 24ms.
      const timeConstant = target > this.gain ? 0.008 : 0.12;
      this.gain += (target - this.gain) * (1 - Math.exp(-1 / (timeConstant * sampleRate)));
      output[index] = sample * this.gain;
    }
    return true;
  }
}

registerProcessor("advoice-noise-gate", NoiseGateProcessor);
