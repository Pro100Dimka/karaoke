export function detectMidiFromAnalyser(analyser, buffer, sampleRate) {
  if (
    !analyser?.getFloatTimeDomainData ||
    !buffer?.length ||
    !Number.isFinite(Number(sampleRate)) ||
    Number(sampleRate) <= 0
  )
    return null;

  try {
    analyser.getFloatTimeDomainData(buffer);
  } catch {
    return null;
  }

  let energy = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    energy += buffer[index] ** 2;
  }

  if (Math.sqrt(energy / buffer.length) < 0.012) return null;

  const minLag = Math.floor(sampleRate / 1000);
  const maxLag = Math.min(buffer.length - 2, Math.floor(sampleRate / 75));
  let bestLag = -1;
  let bestScore = 0;

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    let correlation = 0;
    let leftEnergy = 0;
    let rightEnergy = 0;

    for (let index = 0; index < buffer.length - lag; index += 1) {
      const left = buffer[index];
      const right = buffer[index + lag];
      correlation += left * right;
      leftEnergy += left * left;
      rightEnergy += right * right;
    }

    const score = correlation / Math.sqrt(leftEnergy * rightEnergy || 1);
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestScore < 0.62) return null;

  const frequency = sampleRate / bestLag;
  return Number.isFinite(frequency)
    ? 69 + 12 * Math.log2(frequency / 440)
    : null;
}
