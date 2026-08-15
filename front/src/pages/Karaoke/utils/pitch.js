const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
const MIN_PITCH_HZ = 55;
const MAX_PITCH_HZ = 1760;
const MIN_RMS = 0.01;
const MIN_CORRELATION = 0.62;

export function normalizedCorrelation(buffer, lag) {
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

export function rootMeanSquare(buffer) {
  let energy = 0;
  for (let index = 0; index < buffer.length; index += 1)
    energy += buffer[index] ** 2;
  return Math.sqrt(energy / buffer.length);
}

export function hasSufficientPitchEnergy(buffer) {
  return rootMeanSquare(buffer) >= MIN_RMS;
}

export function isConfidentPitchScore(score) {
  return score >= MIN_CORRELATION;
}

export function getPitchLagRange(bufferLength, rate) {
  const minLag = Math.max(2, Math.floor(rate / MAX_PITCH_HZ) - 1);
  const maxLag = Math.min(bufferLength - 2, Math.ceil(rate / MIN_PITCH_HZ) + 1);
  return maxLag > minLag ? { minLag, maxLag } : null;
}

export function findBestPitchLag(scores, minLag, maxLag) {
  let lag = -1;
  let score = 0;
  for (let candidate = minLag; candidate <= maxLag; candidate += 1) {
    if (scores[candidate] > score) {
      score = scores[candidate];
      lag = candidate;
    }
  }
  return { lag, score };
}

export function selectFundamentalLag( scores, minLag, maxLag, fallbackLag, fallbackScore
) {
  const threshold = Math.max(MIN_CORRELATION, fallbackScore * 0.9);
  for (let lag = minLag + 1; lag < maxLag; lag += 1) {
    if (
      scores[lag] >= threshold &&
      scores[lag] >= scores[lag - 1] &&
      scores[lag] > scores[lag + 1]
    ) {
      return { lag, score: scores[lag] };
    }
  }
  return { lag: fallbackLag, score: fallbackScore };
}

export function refinePitchLag(scores, lag, minLag, maxLag) {
  if (lag <= minLag || lag >= maxLag) return lag;
  const left = scores[lag - 1];
  const center = scores[lag];
  const right = scores[lag + 1];
  const denominator = left - 2 * center + right;
  if (!denominator) return lag;
  const offset = (0.5 * (left - right)) / denominator;
  return lag + clamp(offset, -0.5, 0.5);
}

export function pitchFrequencyToMidi(frequency) {
  if (
    !Number.isFinite(frequency) ||
    frequency < MIN_PITCH_HZ * 0.98 ||
    frequency > MAX_PITCH_HZ * 1.02
  ) {
    return null;
  }
  const bounded = clamp(frequency, MIN_PITCH_HZ, MAX_PITCH_HZ);
  return 69 + 12 * Math.log2(bounded / 440);
}

export function detectMidiFromAnalyser(analyser, buffer, sampleRate) {
  const rate = Number(sampleRate);
  if (!buffer?.length || !Number.isFinite(rate) || rate <= 0) return null;

  try {
    analyser.getFloatTimeDomainData(buffer);
  } catch {
    return null;
  }

  if (!hasSufficientPitchEnergy(buffer)) return null;

  // Cover practical singing range from A1 through A6. The previous
  // 75..1000 Hz window could not detect C2 at all and also clipped high
  // soprano notes above roughly B5.
  // Keep one neighbour outside each nominal boundary so interpolation can
  // resolve A1/A6 instead of snapping them to an octave or rejecting them.
  const range = getPitchLagRange(buffer.length, rate);
  if (!range) return null;
  const { minLag, maxLag } = range;
  const scores = new Float32Array(maxLag + 2);

  for (let lag = minLag; lag <= maxLag; lag += 1) {
    scores[lag] = normalizedCorrelation(buffer, lag);
  }

  const best = findBestPitchLag(scores, minLag, maxLag);
  if (!isConfidentPitchScore(best.score)) return null;

  // Pure and near-pure tones have equally strong autocorrelation peaks at
  // multiples of the true period. Picking the global maximum can therefore
  // report an octave (or two) too low. Prefer the first strong local maximum,
  // which corresponds to the fundamental period.
  const { lag: fundamentalLag } = selectFundamentalLag( scores, minLag, maxLag, best.lag, best.score
  );

  // Sub-sample lag interpolation removes the coarse semitone jumps caused by
  // integer autocorrelation lags, especially on higher notes.
  const refinedLag = refinePitchLag(scores, fundamentalLag, minLag, maxLag);
  return pitchFrequencyToMidi(rate / refinedLag);
}
