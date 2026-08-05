import assert from "node:assert/strict";
import test from "node:test";
import { getSongCardTilt } from "../src/pages/Library/card-tilt.js";

const rect = { left: 100, top: 50, width: 200, height: 100 };

test("song card tilt is neutral at the center", () => {
  assert.deepEqual(getSongCardTilt(200, 100, rect), {
    tiltX: "0deg",
    tiltY: "0deg",
    glowX: "50%",
    glowY: "50%"
  });
});

test("song card tilt maps corners consistently", () => {
  assert.deepEqual(getSongCardTilt(100, 50, rect), {
    tiltX: "3.5deg",
    tiltY: "-3.5deg",
    glowX: "0%",
    glowY: "0%"
  });
  assert.deepEqual(getSongCardTilt(300, 150, rect), {
    tiltX: "-3.5deg",
    tiltY: "3.5deg",
    glowX: "100%",
    glowY: "100%"
  });
});

for (const invalidRect of [
  null,
  {},
  { ...rect, width: 0 },
  { ...rect, height: 0 },
  { ...rect, width: Infinity },
  { ...rect, left: NaN }
]) {
  test(`song card tilt rejects invalid geometry ${JSON.stringify(invalidRect)}`, () => {
    assert.equal(getSongCardTilt(200, 100, invalidRect), null);
  });
}

for (const pointer of [
  [NaN, 100],
  [200, Infinity],
  [undefined, 100],
  [200, null]
]) {
  test(`song card tilt rejects invalid pointer ${String(pointer)}`, () => {
    assert.equal(getSongCardTilt(pointer[0], pointer[1], rect), null);
  });
}
