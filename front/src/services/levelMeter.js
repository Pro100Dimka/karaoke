export function createLevelMeter(
  context,
  { fftSize = 256, smoothingTimeConstant = 0.55, domain = "time" } = {}
) {
  const analyser = context.createAnalyser?.();
  if (!analyser) return null;
  analyser.fftSize = fftSize;
  analyser.smoothingTimeConstant = smoothingTimeConstant;
  const samples = new Uint8Array(domain === "frequency" ? analyser.frequencyBinCount : fftSize);
  return {
    analyser,
    read() {
      if (domain === "frequency") {
        analyser.getByteFrequencyData(samples);
        return samples;
      }
      analyser.getByteTimeDomainData(samples);
      let sum = 0;
      for (const sample of samples) sum += ((sample - 128) / 128) ** 2;
      return Math.sqrt(sum / samples.length);
    }
  };
}
