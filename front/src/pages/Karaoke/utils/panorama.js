export function getPanoramaPosition(elapsed, cycleMs, path) {
  const safeCycle = Number(cycleMs);
  const safeElapsed = Number(elapsed);
  if (!Number.isFinite(safeCycle) || safeCycle <= 0) return { x: 0, y: 48 };

  const phases = path || {};
  const theta =
    (((Number.isFinite(safeElapsed) ? safeElapsed : 0) % safeCycle) / safeCycle) * Math.PI * 2;
  const sine = (phase) => Math.sin(Number(phase) || 0);
  const x =
    22 * (Math.sin(theta + (Number(phases.xPhaseA) || 0)) - sine(phases.xPhaseA)) +
    13 * (Math.sin(theta * 3 + (Number(phases.xPhaseB) || 0)) - sine(phases.xPhaseB)) +
    7 * (Math.sin(theta * 5 + (Number(phases.xPhaseC) || 0)) - sine(phases.xPhaseC));
  const y =
    48 +
    2.4 * (Math.sin(theta * 2 + (Number(phases.yPhaseA) || 0)) - sine(phases.yPhaseA)) +
    1.2 * (Math.sin(theta * 5 + (Number(phases.yPhaseB) || 0)) - sine(phases.yPhaseB));

  return { x, y };
}
