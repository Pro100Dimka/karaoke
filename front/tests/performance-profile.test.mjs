import assert from "node:assert/strict";
import { test, vi } from "vitest";

const loadProfile = async () => {
  vi.resetModules();
  return import("../src/utils/performance-profile.js");
};

test("performance profile detects weak hardware and updates the root", async () => {
  const { applyPerformanceProfile, detectReducedPerformance } =
    await loadProfile();
  const documentElement = { dataset: {} };
  const environment = {
    navigator: { hardwareConcurrency: 4, deviceMemory: 4 },
    document: { documentElement },
    matchMedia: () => ({ matches: false })
  };
  assert.equal(detectReducedPerformance(environment), true);
  assert.equal(detectReducedPerformance({}), false);
  assert.equal(applyPerformanceProfile(environment), true);
  assert.equal(documentElement.dataset.performance, "reduced");
});

test("performance profile leaves capable hardware fully animated", async () => {
  const { applyPerformanceProfile, detectReducedPerformance } =
    await loadProfile();
  const documentElement = { dataset: { performance: "reduced" } };
  const environment = {
    navigator: { hardwareConcurrency: 12, deviceMemory: 16 },
    document: { documentElement },
    matchMedia: () => ({ matches: false })
  };
  assert.equal(applyPerformanceProfile(environment), false);
  assert.equal(documentElement.dataset.performance, undefined);
  assert.equal(
    detectReducedPerformance({ navigator: { hardwareConcurrency: 4, deviceMemory: 16 } }),
    true
  );
  assert.equal(
    detectReducedPerformance({ navigator: { hardwareConcurrency: 12, deviceMemory: 4 } }),
    true
  );
  for (const value of [0, -1, 5, Number.NaN, Number.POSITIVE_INFINITY]) {
    assert.equal(
      detectReducedPerformance({ navigator: { hardwareConcurrency: value, deviceMemory: 16 } }),
      false
    );
    assert.equal(
      detectReducedPerformance({ navigator: { hardwareConcurrency: 12, deviceMemory: value } }),
      false
    );
  }
});

test("performance profile honors reduced motion and safely skips missing APIs", async () => {
  const { applyPerformanceProfile, detectReducedPerformance } =
    await loadProfile();
  const matchMedia = (query) => {
    assert.equal(query, "(prefers-reduced-motion: reduce)");
    return { matches: true };
  };
  assert.equal(
    detectReducedPerformance({
      navigator: { hardwareConcurrency: 12, deviceMemory: 16 },
      matchMedia
    }),
    true
  );
  assert.equal(
    detectReducedPerformance({
      navigator: { hardwareConcurrency: 12, deviceMemory: 16 },
      matchMedia: () => undefined
    }),
    false
  );
  assert.equal(applyPerformanceProfile({ navigator: {} }), false);
});

test("processing load temporarily forces the reduced profile and restores it", async () => {
  const { setProcessingLoadActive } = await loadProfile();
  const documentElement = { dataset: {} };
  const environment = { document: { documentElement } };

  setProcessingLoadActive(true, environment);
  assert.equal(documentElement.dataset.performance, "reduced");
  setProcessingLoadActive(false, environment);
  assert.equal(documentElement.dataset.performance, undefined);
});

test("processing load never turns off a hardware-forced reduced profile", async () => {
  const { setProcessingLoadActive } = await loadProfile();
  const documentElement = { dataset: { performance: "reduced" } };
  const environment = { document: { documentElement } };

  // The very first call captures the pre-existing hardware baseline; since it
  // was already reduced, processing load must not touch it either way.
  setProcessingLoadActive(true, environment);
  assert.equal(documentElement.dataset.performance, "reduced");
  setProcessingLoadActive(false, environment);
  assert.equal(documentElement.dataset.performance, "reduced");
});

test("processing load is a no-op without a document", async () => {
  const { setProcessingLoadActive } = await loadProfile();
  assert.doesNotThrow(() => setProcessingLoadActive(true, {}));
});
