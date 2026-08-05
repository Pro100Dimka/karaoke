import assert from "node:assert/strict";
import test from "node:test";
import { getPanoramaPosition } from "../src/pages/Karaoke/utils/panorama.js";

const PATH = {
  xPhaseA: 0.2,
  xPhaseB: 0.7,
  xPhaseC: 1.1,
  yPhaseA: 0.4,
  yPhaseB: 0.9
};

test("panorama path is closed at the cycle boundary", () => {
  const start = getPanoramaPosition(0, 240000, PATH);
  const end = getPanoramaPosition(240000, 240000, PATH);
  assert.ok(Math.abs(start.x - end.x) < 1e-10);
  assert.ok(Math.abs(start.y - end.y) < 1e-10);
});

test("panorama position remains finite for malformed input", () => {
  const position = getPanoramaPosition(Number.NaN, 0, null);
  assert.deepEqual(position, { x: 0, y: 48 });
});

test("panorama produces motion inside a cycle", () => {
  const start = getPanoramaPosition(0, 240000, PATH);
  const middle = getPanoramaPosition(60000, 240000, PATH);
  assert.notDeepEqual(start, middle);
  assert.ok(Number.isFinite(middle.x));
  assert.ok(Number.isFinite(middle.y));
});
