import { expect, test } from "vitest";
import {
  nextAdaptivePixelRatio,
  QFT_DEFAULT_SETTINGS
} from "../src/pages/Library/animated-backdrop/qft-settings.js";

const bounds = { targetFPS: 60, pixelRatioMax: 1.5, minPixelRatio: 0.75 };

test("adaptive quality is enabled by default so weak hardware isn't stuck at a fixed pixel ratio", () => {
  expect(QFT_DEFAULT_SETTINGS.adaptiveQuality).toBe(true);
});

test("nextAdaptivePixelRatio steps down when FPS falls behind target and clamps at the floor", () => {
  expect(nextAdaptivePixelRatio(1.5, 40, bounds)).toBeCloseTo(1.4, 5);
  expect(nextAdaptivePixelRatio(0.8, 40, bounds)).toBeCloseTo(0.75, 5);
  expect(nextAdaptivePixelRatio(0.75, 10, bounds)).toBe(0.75);
});

test("nextAdaptivePixelRatio steps back up once FPS clears target and clamps at pixelRatioMax", () => {
  expect(nextAdaptivePixelRatio(1.0, 70, bounds)).toBeCloseTo(1.05, 5);
  expect(nextAdaptivePixelRatio(1.48, 120, bounds)).toBeCloseTo(1.5, 5);
  expect(nextAdaptivePixelRatio(1.5, 144, bounds)).toBe(1.5);
});

test("nextAdaptivePixelRatio holds steady in the dead zone around target FPS", () => {
  expect(nextAdaptivePixelRatio(1.2, 60, bounds)).toBe(1.2);
  expect(nextAdaptivePixelRatio(1.2, 53, bounds)).toBe(1.2);
  expect(nextAdaptivePixelRatio(1.2, 65, bounds)).toBe(1.2);
});
