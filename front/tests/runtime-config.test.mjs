import { afterEach, expect, test, vi } from "vitest";
import { same } from "./helpers/assertions.mjs";
afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});
test("accepts positive runtime overrides", async () => {
  vi.stubEnv("VITE_POLLING_SCALE", "2");
  vi.stubEnv("VITE_BACKEND_RETRY_MS", "25");
  vi.stubEnv("VITE_API_BASE_URL", "https://example.test///");
  const runtime = await import("../src/runtime-config.js");
  same([runtime.POLLING_INTERVALS.processing, 2000], [runtime.BACKEND_BOOT_RETRY_MS, 25], [runtime.API_BASE_URL, "https://example.test"]);
});
test("rejects non-positive runtime overrides", async () => {
  vi.stubEnv("VITE_POLLING_SCALE", "0");
  vi.stubEnv("VITE_BACKEND_RETRY_MS", "0");
  const runtime = await import("../src/runtime-config.js");
  same([runtime.POLLING_INTERVALS.processing, 1000], [runtime.BACKEND_BOOT_RETRY_MS, 450], [runtime.API_BASE_URL, "http://127.0.0.1:8000"]);
});
