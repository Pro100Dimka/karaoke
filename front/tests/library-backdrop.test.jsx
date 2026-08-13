/* @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";

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

import LibraryBackdrop from "../src/pages/Library/components/backdrop/index.jsx";

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
  expect(
    container.querySelectorAll(".library-music-object--record span")
  ).toHaveLength(4);
  expect(
    container.querySelectorAll(".library-music-object--notes span")
  ).toHaveLength(18);
  expect(context.setTransform).toHaveBeenCalled();
  expect(context.clearRect).toHaveBeenCalled();
  expect(context.stroke).toHaveBeenCalled();
  expect(context.fillRect).toHaveBeenCalled();
  fireEvent(window, new Event("resize"));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: true
  });
  fireEvent(document, new Event("visibilitychange"));
  Object.defineProperty(document, "hidden", {
    configurable: true,
    value: false
  });
  fireEvent(document, new Event("visibilitychange"));
  unmount();
  expect(globalThis.cancelAnimationFrame).toHaveBeenCalled();
});

test("parallax follows pointer and cleans root variables", () => {
  const { unmount } = render(<LibraryBackdrop />);
  const frameCount = globalThis.requestAnimationFrame.mock.calls.length;
  fireEvent.pointerMove(window, { clientX: 100, clientY: 100 });
  fireEvent.mouseLeave(document);
  expect(globalThis.requestAnimationFrame.mock.calls.length).toBeGreaterThan(
    frameCount
  );
  unmount();
  expect(
    document.documentElement.style.getPropertyValue("--library-parallax-x")
  ).toBe("");
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
