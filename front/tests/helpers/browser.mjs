import { vi } from "vitest";

export const installFrameQueue = () => {
  const frames = [];
  globalThis.requestAnimationFrame = vi.fn((callback) => (frames.push(callback), frames.length));
  return frames;
};

export const stubFrameQueue = () => {
  const frames = [];
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn((callback) => (frames.push(callback), frames.length))
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
  return frames;
};

export const stubImmediateAnimationFrame = () => {
  vi.stubGlobal("requestAnimationFrame", (callback) => (callback(), 1));
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
};

export const suppressWindowErrors = () => {
  const log = vi.spyOn(console, "error").mockImplementation(() => {});
  const suppress = (event) => event.preventDefault();
  window.addEventListener("error", suppress);
  return { log, restore: () => (window.removeEventListener("error", suppress), log.mockRestore()) };
};
