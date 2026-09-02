function getBandBoost(band) {
  if (band < 5) return 1.42;
  if (band < 12) return 1.72;
  return 2.05;
}

export const isAutoplayBlocked = (reason) =>
  reason?.name === "NotAllowedError" ||
  /user didn't interact|user gesture|not allowed/i.test(String(reason?.message ?? reason ?? ""));

export function calculateRadioLightingPulse(currentBands, previousBands, previousPulse = 0) {
  const ranges = [
    [0, 6, 7],
    [6, 13, 9],
    [13, 18, 12]
  ];
  const attacks = ranges.map(([from, to, boost]) => {
    let rise = 0;
    for (let index = from; index < to; index += 1) {
      rise += Math.max(
        0,
        (Number(currentBands?.[index]) || 0) - (Number(previousBands?.[index]) || 0) - 0.004
      );
    }
    return Math.min(1, (rise / Math.max(1, to - from)) * boost);
  });
  const hit = Math.max(...attacks);
  const before = Math.min(1, Math.max(0, Number(previousPulse) || 0));
  // A percussion pulse is deliberately short-lived. A slow release makes
  // frequent kicks accumulate into a permanently bright bed, hiding every
  // later hit even though the detector still sees it.
  return hit > before ? before + (hit - before) * 0.82 : before * 0.72;
}

export function calculateRadioSpectrum(data, sampleRate, fftSize, previousBass, previousBands) {
  const binHz = sampleRate / fftSize;
  const averageRange = (fromHz, toHz) => {
    const first = Math.max(1, Math.floor(fromHz / binHz));
    const last = Math.min(data.length - 1, Math.ceil(toHz / binHz));
    let sum = 0;
    for (let index = first; index <= last; index += 1) sum += data[index];
    return sum / Math.max(1, last - first + 1) / 255;
  };
  const rawBass = averageRange(35, 180);
  const bass = previousBass + (rawBass - previousBass) * (rawBass > previousBass ? 0.46 : 0.12);
  const minHz = 45;
  const maxHz = Math.min(12000, sampleRate * 0.45);
  const bands = previousBands.map((previous, band, allBands) => {
    const fromHz = minHz * (maxHz / minHz) ** (band / allBands.length);
    const toHz = minHz * (maxHz / minHz) ** ((band + 1) / allBands.length);
    const raw = averageRange(fromHz, toHz);
    const boosted = Math.min(1, raw * getBandBoost(band));
    return previous + (boosted - previous) * (boosted > previous ? 0.58 : 0.16);
  });
  return { bands, bass };
}
