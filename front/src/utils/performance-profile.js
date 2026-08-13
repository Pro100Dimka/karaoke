export function detectReducedPerformance(environment = globalThis) {
  const navigatorInfo = environment.navigator || {};
  const cores = Number(navigatorInfo.hardwareConcurrency);
  const memory = Number(navigatorInfo.deviceMemory);
  const requested = environment.matchMedia?.(
    "(prefers-reduced-motion: reduce)"
  )?.matches;
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
