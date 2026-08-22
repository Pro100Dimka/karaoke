import assert from "node:assert/strict";
import { test, vi } from "vitest";
import { equal } from "./helpers/assertions.mjs";
const loadProfile = async () => {
  vi.resetModules();
  return import("../src/utils/performance-profile.js");
};
test("performance profile detects weak hardware and updates the root", async () => {
  const { applyPerformanceProfile, detectReducedPerformance } = await loadProfile();
  const documentElement = { dataset: {} };
  const environment = {
    navigator: { hardwareConcurrency: 4, deviceMemory: 4 },
    document: { documentElement },
    matchMedia: () => ({ matches: false })
  };
  equal(
    [detectReducedPerformance(environment), true],
    [detectReducedPerformance({}), false],
    [applyPerformanceProfile(environment), true],
    [documentElement.dataset.performance, "reduced"]
  );
});
test("performance profile leaves capable hardware fully animated", async () => {
  const { applyPerformanceProfile, detectReducedPerformance } = await loadProfile();
  const documentElement = { dataset: { performance: "reduced" } };
  const environment = {
    navigator: { hardwareConcurrency: 12, deviceMemory: 16 },
    document: { documentElement },
    matchMedia: () => ({ matches: false })
  };
  equal(
    [applyPerformanceProfile(environment), false],
    [documentElement.dataset.performance, undefined],
    [detectReducedPerformance({ navigator: { hardwareConcurrency: 4, deviceMemory: 16 } }), true],
    [detectReducedPerformance({ navigator: { hardwareConcurrency: 12, deviceMemory: 4 } }), true]
  );
  for (const value of [0, -1, 5, Number.NaN, Number.POSITIVE_INFINITY]) {
    equal(
      [detectReducedPerformance({ navigator: { hardwareConcurrency: value, deviceMemory: 16 } }), false],
      [detectReducedPerformance({ navigator: { hardwareConcurrency: 12, deviceMemory: value } }), false]
    );
  }
});
test("performance profile honors reduced motion and safely skips missing APIs", async () => {
  const { applyPerformanceProfile, detectReducedPerformance } = await loadProfile();
  const matchMedia = (query) => {
    equal([query, "(prefers-reduced-motion: reduce)"]);
    return { matches: true };
  };
  equal(
    [
      detectReducedPerformance({
        navigator: { hardwareConcurrency: 12, deviceMemory: 16 },
        matchMedia
      }),
      true
    ],
    [
      detectReducedPerformance({
        navigator: { hardwareConcurrency: 12, deviceMemory: 16 },
        matchMedia: () => undefined
      }),
      false
    ],
    [applyPerformanceProfile({ navigator: {} }), false]
  );
});
test("processing load temporarily forces the reduced profile and restores it", async () => {
  const { setProcessingLoadActive } = await loadProfile();
  const documentElement = { dataset: {} };
  const environment = { document: { documentElement } };
  setProcessingLoadActive(true, environment);
  equal([documentElement.dataset.performance, "reduced"]);
  setProcessingLoadActive(false, environment);
  equal([documentElement.dataset.performance, undefined]);
});
test("processing load never turns off a hardware-forced reduced profile", async () => {
  const { setProcessingLoadActive } = await loadProfile();
  const documentElement = { dataset: { performance: "reduced" } };
  const environment = { document: { documentElement } };
  // The very first call captures the pre-existing hardware baseline; since it
  // was already reduced, processing load must not touch it either way.
  setProcessingLoadActive(true, environment);
  equal([documentElement.dataset.performance, "reduced"]);
  setProcessingLoadActive(false, environment);
  equal([documentElement.dataset.performance, "reduced"]);
});
test("processing load is a no-op without a document", async () => {
  const { setProcessingLoadActive } = await loadProfile();
  assert.doesNotThrow(() => setProcessingLoadActive(true, {}));
});
