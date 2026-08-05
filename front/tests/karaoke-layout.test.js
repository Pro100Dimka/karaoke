import assert from "node:assert/strict";
import test from "node:test";
import { getKaraokeStageLayout } from "../src/pages/Karaoke/utils/layout.js";

test("getKaraokeStageLayout preserves 16:9 video cover dimensions", () => {
  assert.deepEqual(
    getKaraokeStageLayout({
      mainWidth: 1600,
      mainHeight: 1000,
      stageWidth: 1200,
      stageHeight: 800
    }),
    { navExtra: 100, videoWidth: 1425, videoHeight: 802 }
  );
});

test("getKaraokeStageLayout handles invalid dimensions safely", () => {
  const layout = getKaraokeStageLayout({
    mainWidth: "bad",
    mainHeight: -1,
    stageWidth: null,
    stageHeight: undefined,
    currentNavExtra: -20
  });
  assert.deepEqual(layout, { navExtra: 0, videoWidth: 2, videoHeight: 2 });
});

test("getKaraokeStageLayout carries previous nav compensation", () => {
  const layout = getKaraokeStageLayout({
    mainWidth: 1280,
    mainHeight: 600,
    stageWidth: 1280,
    stageHeight: 720,
    currentNavExtra: 200
  });
  assert.equal(layout.navExtra, 80);
});
