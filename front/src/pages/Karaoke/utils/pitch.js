const MIN_PITCH_HZ = 55;
const MAX_PITCH_HZ = 1760;
const MIN_RMS = 0.01;
const MIN_CORRELATION = 0.62;

function correlationScore(buffer, lag) {
  let correlation = 0;
  let leftEnergy = 0;
  let rightEnergy = 0;
  const limit = buffer.length - lag;

  for (let index = 0; index < limit; index += 1) {
    const left = buffer[index];
    const right = buffer[index + lag];
    correlation += left * right;
    leftEnergy += left * left;
    rightEnergy += right * right;
  }

  const denominator = Math.sqrt(leftEnergy * rightEnergy);
  return denominator > 0 ? correlation / denominator : 0;
}

export function detectMidiFromAnalyser(analyser, buffer, sampleRate) {
  const rate = Number(sampleRate);
  if (
    !analyser?.getFloatTimeDomainData ||
    !buffer?.length ||
    !Number.isFinite(rate) ||
    rate <= 0
  ) {
    return null;
  }

  try {
    analyser.getFloatTimeDomainData(buffer);
  } catch {
    return null;
  }

  let energy = 0;
  for (let index = 0; index < buffer.length; index += 1) {
    energy += buffer[index] ** 2;
  }

  if (Math.sqrt(energy / buffer.length) < MIN_RMS) return null;

  // Cover practical singing range from A1 through A6. The previous
  // 75..1000 Hz window could not detect C2 at all and also clipped high
  // soprano notes above roughly B5.
  const minLag = Math.max(2, Math.floor(rate / MAX_PITCH_HZ));
  const maxLag = Math.min(buffer.length - 2, Math.ceil(rate / MIN_PITCH_HZ));
  if (maxLag <= minLag) return null;

  let bestLag = -1;
  let bestScore = 0;
  const scores = new Float32Array(maxLag + 2);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    const score = correlationScore(buffer, lag);
    scores[lag] = score;
    if (score > bestScore) {
      bestScore = score;
      bestLag = lag;
    }
  }

  if (bestLag < 0 || bestScore < MIN_CORRELATION) return null;

  // Pure and near-pure tones have equally strong autocorrelation peaks at
  // multiples of the true period. Picking the global maximum can therefore
  // report an octave (or two) too low. Prefer the first strong local maximum,
  // which corresponds to the fundamental period.
  const peakThreshold = Math.max(MIN_CORRELATION, bestScore * 0.9);
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (
      scores[lag] >= peakThreshold &&
      scores[lag] >= scores[lag - 1] &&
      scores[lag] > scores[lag + 1]
    ) {
      bestLag = lag;
      bestScore = scores[lag];
      break;
    }
  }

  // Sub-sample lag interpolation removes the coarse semitone jumps caused by
  // integer autocorrelation lags, especially on higher notes.
  let refinedLag = bestLag;
  if (bestLag > minLag && bestLag < maxLag) {
    const left = scores[bestLag - 1];
    const center = scores[bestLag];
    const right = scores[bestLag + 1];
    const denominator = left - 2 * center + right;
    if (Number.isFinite(denominator) && Math.abs(denominator) > 1e-9) {
      const offset = (0.5 * (left - right)) / denominator;
      if (Number.isFinite(offset)) {
        refinedLag += Math.max(-0.5, Math.min(0.5, offset));
      }
    }
  }

  const frequency = rate / refinedLag;
  if (
    !Number.isFinite(frequency) ||
    frequency < MIN_PITCH_HZ ||
    frequency > MAX_PITCH_HZ
  ) {
    return null;
  }

  const midi = 69 + 12 * Math.log2(frequency / 440);
  return Number.isFinite(midi) ? midi : null;
}
