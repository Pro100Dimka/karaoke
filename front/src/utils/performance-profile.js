const baselines = new WeakMap();
const rootOf = (environment) => environment.document?.documentElement;
export function detectReducedPerformance(environment = globalThis) {
  const { hardwareConcurrency, deviceMemory } = environment.navigator ?? {};
  const cores = Number(hardwareConcurrency);
  const memory = Number(deviceMemory);
  return Boolean(
    environment.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches ||
    (Number.isFinite(cores) && cores > 0 && cores <= 4) ||
    (Number.isFinite(memory) && memory > 0 && memory <= 4)
  );
}
export function applyPerformanceProfile(environment = globalThis) {
  const root = rootOf(environment);
  if (!root) return false;
  const reduced = detectReducedPerformance(environment);
  if (reduced) root.dataset.performance = "reduced";
  else delete root.dataset.performance;
  return reduced;
}
export function setProcessingLoadActive(active, environment = globalThis) {
  const root = rootOf(environment);
  if (!root) return;
  if (!baselines.has(root)) baselines.set(root, root.dataset.performance === "reduced");
  if (baselines.get(root)) return;
  if (active) root.dataset.performance = "reduced";
  else delete root.dataset.performance;
}
