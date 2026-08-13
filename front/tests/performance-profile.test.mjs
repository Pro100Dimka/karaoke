import assert from "node:assert/strict";
import { test } from "vitest";

import {
  applyPerformanceProfile,
  detectReducedPerformance
} from "../src/utils/performance-profile.js";

test("performance profile detects weak hardware and updates the root", () => {
  const documentElement = { dataset: {} };
  const environment = {
    navigator: { hardwareConcurrency: 4, deviceMemory: 4 },
    document: { documentElement },
    matchMedia: () => ({ matches: false })
  };
  assert.equal(detectReducedPerformance(environment), true);
  assert.equal(applyPerformanceProfile(environment), true);
  assert.equal(documentElement.dataset.performance, "reduced");
});

test("performance profile leaves capable hardware fully animated", () => {
  const documentElement = { dataset: { performance: "reduced" } };
  const environment = {
    navigator: { hardwareConcurrency: 12, deviceMemory: 16 },
    document: { documentElement },
    matchMedia: () => ({ matches: false })
  };
  assert.equal(applyPerformanceProfile(environment), false);
  assert.equal(documentElement.dataset.performance, undefined);
});
