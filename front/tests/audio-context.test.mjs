import { expect, test, vi } from "vitest";
import { closeAudioContext, closeAudioContextQuietly } from "../src/utils/audio-context.js";

test("audio context cleanup tolerates every close implementation", async () => {
  const resolved = { close: vi.fn().mockResolvedValue(undefined) };
  await expect(closeAudioContext(resolved)).resolves.toBe(true);
  expect(resolved.close).toHaveBeenCalledOnce();

  const synchronous = { close: vi.fn(() => undefined) };
  await expect(closeAudioContext(synchronous)).resolves.toBe(true);

  const rejected = { close: vi.fn().mockRejectedValue(new Error("closed")) };
  await expect(closeAudioContext(rejected)).resolves.toBe(false);

  const throwing = { close: vi.fn(() => { throw new Error("already closed"); }) };
  await expect(closeAudioContext(throwing)).resolves.toBe(false);

  const alreadyClosed = { state: "closed", close: vi.fn() };
  await expect(closeAudioContext(alreadyClosed)).resolves.toBe(false);
  expect(alreadyClosed.close).not.toHaveBeenCalled();

  expect(() => closeAudioContextQuietly(throwing)).not.toThrow();
});
