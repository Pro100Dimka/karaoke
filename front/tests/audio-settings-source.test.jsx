import { describe, expect, test } from "vitest";
import { signalLevel } from "../src/pages/Settings/use-settings.js";

describe("settings audio signal", () => {
  test.each([
    [null, 0],
    [{ rms_db: -60 }, 0],
    [{ rms_db: -30 }, 50],
    [{ rms_dbfs: 0 }, 100],
    [{ rms_db: 20 }, 100],
    [{ rms_db: "bad" }, 0]
  ])("normalizes %#", (signal, expected) => {
    expect(signalLevel(signal)).toBe(expected);
  });
});
