import { afterEach, beforeEach } from "vitest";

if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class ResizeObserver {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// UI assertions use Russian unless a localization test explicitly chooses another locale.
beforeEach(() => {
  if (!globalThis.localStorage) {
    const values = new Map();
    globalThis.localStorage = {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => values.set(key, String(value)),
      removeItem: (key) => values.delete(key),
      clear: () => values.clear()
    };
  }
  globalThis.localStorage.setItem("advoice-language", "ru");
});

afterEach(async () => {
  if (!globalThis.document) return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
