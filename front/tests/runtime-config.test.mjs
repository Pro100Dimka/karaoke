import { afterEach, expect, test, vi } from "vitest";

afterEach(() => {
  vi.unstubAllEnvs();
  vi.resetModules();
});

test("accepts positive runtime overrides", async () => {
  vi.stubEnv("VITE_POLLING_SCALE", "2");
  vi.stubEnv("VITE_BACKEND_RETRY_MS", "25");
  vi.stubEnv("VITE_API_BASE_URL", "https://example.test///");
  const runtime = await import("../src/runtime-config.js");
  expect(runtime.POLLING_INTERVALS.processing).toBe(2000);
  expect(runtime.BACKEND_BOOT_RETRY_MS).toBe(25);
  expect(runtime.API_BASE_URL).toBe("https://example.test");
});

test("rejects non-positive runtime overrides", async () => {
  vi.stubEnv("VITE_POLLING_SCALE", "0");
  vi.stubEnv("VITE_BACKEND_RETRY_MS", "0");
  const runtime = await import("../src/runtime-config.js");
  expect(runtime.POLLING_INTERVALS.processing).toBe(1000);
  expect(runtime.BACKEND_BOOT_RETRY_MS).toBe(450);
  expect(runtime.API_BASE_URL).toBe("http://127.0.0.1:8000");
});
