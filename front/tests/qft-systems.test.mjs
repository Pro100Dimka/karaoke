import { expect, test } from "vitest";
import { forEachNearbyPair } from "../src/pages/Library/animated-backdrop/qftSystems.js";

function bruteForcePairs(pts, cellSize) {
  const pairs = [];
  for (let i = 0; i < pts.length; i += 1) {
    for (let j = i + 1; j < pts.length; j += 1) {
      const dx = pts[i].x - pts[j].x;
      const dy = pts[i].y - pts[j].y;
      const dz = pts[i].z - pts[j].z;
      if (Math.sqrt(dx * dx + dy * dy + dz * dz) <= cellSize) pairs.push([i, j]);
    }
  }
  return pairs;
}

function seededPoints(count, spread, seed = 1) {
  let value = seed;
  const next = () => {
    value = (value * 16807) % 2147483647;
    return value / 2147483647;
  };
  return Array.from({ length: count }, () => ({
    x: (next() - 0.5) * spread,
    y: (next() - 0.5) * spread,
    z: (next() - 0.5) * spread
  }));
}

test("forEachNearbyPair never misses a pair a brute-force all-pairs scan would find", () => {
  // forEachNearbyPair is a broad-phase candidate generator: it may offer a
  // pair slightly farther apart than cellSize (anything sharing the 3x3x3
  // cell neighborhood), leaving the real distance check to the caller (see
  // createForceNetwork's own d2 >= thresholdSq filter) -- but it must never
  // miss a pair that's genuinely within range, or connections would silently
  // vanish instead of just costing a few extra, harmless distance checks.
  const pts = seededPoints(120, 60);
  const cellSize = 8;
  const expected = bruteForcePairs(pts, cellSize);
  const found = new Set();
  forEachNearbyPair(pts, cellSize, Infinity, (i, j) => {
    found.add(`${i}-${j}`);
    return true;
  });
  for (const [i, j] of expected) expect(found.has(`${i}-${j}`)).toBe(true);
});

test("forEachNearbyPair never emits a self-pair or a duplicate/reversed pair", () => {
  const pts = seededPoints(80, 40, 7);
  const seen = new Set();
  forEachNearbyPair(pts, 10, Infinity, (i, j) => {
    expect(i).toBeLessThan(j);
    const key = `${i}-${j}`;
    expect(seen.has(key)).toBe(false);
    seen.add(key);
    return true;
  });
});

test("forEachNearbyPair stops once the caller has accepted `limit` pairs", () => {
  const pts = seededPoints(200, 60, 3);
  let accepted = 0;
  forEachNearbyPair(pts, 12, 5, () => {
    accepted += 1;
    return true;
  });
  expect(accepted).toBe(5);
});

test("forEachNearbyPair only counts pairs the caller accepts, not ones it rejects", () => {
  const pts = seededPoints(100, 60, 9);
  let visited = 0;
  let accepted = 0;
  forEachNearbyPair(pts, 10, 3, () => {
    visited += 1;
    const accept = visited % 2 === 0;
    if (accept) accepted += 1;
    return accept;
  });
  expect(accepted).toBe(3);
  // Rejected candidates must not count against the limit.
  expect(visited).toBeGreaterThan(3);
});
