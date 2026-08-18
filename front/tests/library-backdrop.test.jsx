/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import LibraryBackdrop from "../src/pages/Library/components/backdrop/index.jsx";
import { called, notCalled, verify } from "./helpers/assertions.mjs";
import { installFrameQueue } from "./helpers/browser.mjs";

const mocks = vi.hoisted(() => ({
  playing: true,
  bass: vi.fn(() => 0.6),
  spectrum: vi.fn(() => Array(18).fill(0.4))
}));
vi.mock("../src/contexts/radio", () => ({
  useRadio: () => ({
    isPlaying: mocks.playing,
    getBassLevel: mocks.bass,
    getSpectrumLevels: mocks.spectrum
  })
}));
const context = {
  setTransform: vi.fn(),
  save: vi.fn(),
  restore: vi.fn(),
  beginPath: vi.fn(),
  moveTo: vi.fn(),
  lineTo: vi.fn(),
  stroke: vi.fn(),
  clearRect: vi.fn(),
  fillRect: vi.fn()
};
beforeEach(() => {
  vi.clearAllMocks();
  mocks.playing = true;
  let nextFrame = 0;
  globalThis.requestAnimationFrame = vi.fn((callback) => {
    nextFrame += 1;
    if (nextFrame <= 2) callback(nextFrame * 40);
    return nextFrame;
  });
  globalThis.cancelAnimationFrame = vi.fn();
  globalThis.matchMedia = vi.fn(() => ({
    matches: false,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn()
  }));
  HTMLCanvasElement.prototype.getContext = vi.fn(() => context);
  Object.defineProperties(HTMLCanvasElement.prototype, {
    clientWidth: { configurable: true, get: () => 800 },
    clientHeight: { configurable: true, get: () => 300 }
  });
});
afterEach(() => {
  cleanup();
  document.documentElement.dataset.performance = "";
});
test("backdrop renders decorations and animated terrain", () => {
  const { container, unmount } = render(<LibraryBackdrop />);
  verify([container.querySelectorAll(".library-music-object--record span"), "toHaveLength", 4]);
  verify([container.querySelectorAll(".library-music-object--notes span"), "toHaveLength", 18]);
  called(context.setTransform, context.clearRect, context.stroke, context.fillRect);
  fireEvent(window, new Event("resize"));
  Object.defineProperty(document, "hidden", { configurable: true, value: true });
  fireEvent(document, new Event("visibilitychange"));
  Object.defineProperty(document, "hidden", { configurable: true, value: false });
  fireEvent(document, new Event("visibilitychange"));
  unmount();
  expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
});
test("parallax follows pointer and cleans root variables", () => {
  const { unmount } = render(<LibraryBackdrop />);
  const frameCount = globalThis.requestAnimationFrame.mock.calls.length;
  fireEvent.pointerMove(window, { clientX: 100, clientY: 100 });
  fireEvent.mouseLeave(document);
  verify([globalThis.requestAnimationFrame.mock.calls.length, "toBeGreaterThan", frameCount]);
  unmount();
  verify([document.documentElement.style.getPropertyValue("--library-parallax-x"), "toBe", ""]);
});
test("reduced performance skips parallax registration", () => {
  document.documentElement.dataset.performance = "reduced";
  const add = vi.spyOn(globalThis, "addEventListener");
  render(<LibraryBackdrop />);
  expect(add.mock.calls.some(([type]) => type === "pointermove")).toBe(false);
});
test("terrain tolerates unavailable canvas context", () => {
  HTMLCanvasElement.prototype.getContext = vi.fn(() => null);
  expect(() => render(<LibraryBackdrop />)).not.toThrow();
});
test("runs queued parallax and reacts to theme changes", async () => {
  const frames = installFrameQueue();
  render(<LibraryBackdrop />);
  fireEvent.pointerMove(window, { clientX: 120, clientY: 80 });
  let timestamp = 40;
  while (frames.length && timestamp < 20_000) {
    frames.shift()(timestamp);
    timestamp += 40;
  }
  document.documentElement.dataset.theme = "changed";
  await act(async () => Promise.resolve());
  verify([document.documentElement.style.getPropertyValue("--library-parallax-x"), "not.toBe", ""]);
});
test("terrain traverses hidden mesh gaps across animation phases", () => {
  const frames = installFrameQueue();
  render(<LibraryBackdrop />);
  for (let timestamp = 0; timestamp <= 120_000; timestamp += 1000) {
    const callback = frames.shift();
    if (!callback) break;
    callback(timestamp);
  }
  expect(context.stroke).toHaveBeenCalled();
});
test("terrain uses theme colors and silent fallbacks", () => {
  mocks.playing = false;
  const descriptor = Object.getOwnPropertyDescriptor(window, "devicePixelRatio");
  Object.defineProperty(window, "devicePixelRatio", { configurable: true, value: 0 });
  const style = vi.spyOn(globalThis, "getComputedStyle").mockReturnValue({
    getPropertyValue: (name) => (name === "--wave-terrain-rgb" ? "1,2,3" : "4,5,6")
  });
  render(<LibraryBackdrop />);
  notCalled(mocks.bass, mocks.spectrum);
  style.mockRestore();
  if (descriptor) Object.defineProperty(window, "devicePixelRatio", descriptor);
});
