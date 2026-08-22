import { afterEach } from "vitest";

afterEach(async () => {
  if (!globalThis.document) return;
  const { cleanup } = await import("@testing-library/react");
  cleanup();
});
