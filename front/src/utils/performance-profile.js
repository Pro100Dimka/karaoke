export function detectReducedPerformance(environment = globalThis) {
  const navigatorInfo = environment.navigator || {};
  const cores = Number(navigatorInfo.hardwareConcurrency);
  const memory = Number(navigatorInfo.deviceMemory);
  const requested = environment.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
  return Boolean(
    requested ||
    (Number.isFinite(cores) && cores > 0 && cores <= 4) ||
    (Number.isFinite(memory) && memory > 0 && memory <= 4)
  );
}

export function applyPerformanceProfile(environment = globalThis) {
  const root = environment.document?.documentElement;
  if (!root) return false;
  const reduced = detectReducedPerformance(environment);
  if (reduced) root.dataset.performance = "reduced";
  else delete root.dataset.performance;
  return reduced;
}

let hardwareBaselineReduced = null;

// AI processing (vocal separation, etc.) saturates the GPU on its own; the
// always-on Library background animations (wave-terrain canvas, CSS
// blur/light-sweep) were competing with it for the same GPU and pushing an
// already-loaded driver into stalls -- observed as the whole system freezing
// while a song processes, which cleared up the moment the renderer's GPU
// process was killed (closing the window) even though the backend kept
// working. Reuse the existing low-end-hardware "reduced" profile as a
// temporary override instead of a second, parallel disable mechanism.
export function setProcessingLoadActive(active, environment = globalThis) {
  const root = environment.document?.documentElement;
  if (!root) return;
  if (hardwareBaselineReduced === null) {
    hardwareBaselineReduced = root.dataset.performance === "reduced";
  }
  if (hardwareBaselineReduced) return;
  if (active) root.dataset.performance = "reduced";
  else delete root.dataset.performance;
}
