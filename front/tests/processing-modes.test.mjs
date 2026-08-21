import { describe, expect, test } from "vitest";
import {
  DEFAULT_PROCESSING_MODE,
  getProcessingModeOptions,
  normalizeProcessingMode
} from "../src/pages/Library/processing-modes.js";

describe("song processing modes", () => {
  test("exposes every supported mode with a distinct user-facing label", () => {
    expect(getProcessingModeOptions()).toEqual([
      { value: "auto", label: "Авто · быстро для этого компьютера" },
      { value: "fast", label: "Быстрый · минимальное время" },
      { value: "quality", label: "Качество · точнее разделение" }
    ]);
  });

  test.each(["auto", "fast", "quality"])("preserves supported mode %s", (mode) => {
    expect(normalizeProcessingMode(mode)).toBe(mode);
  });

  test.each([undefined, null, "", "turbo"])("defaults unsupported mode %s", (mode) => {
    expect(normalizeProcessingMode(mode)).toBe(DEFAULT_PROCESSING_MODE);
  });
});
