import { afterEach, expect, test, vi } from "vitest";
import { playParticipantJoinedSound } from "../src/contexts/onlineRoomAudio.js";

afterEach(() => {
  vi.restoreAllMocks();
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
});

test("closes the participant notification AudioContext when playback actually ends", async () => {
  const oscillators = [];
  const close = vi.fn().mockResolvedValue(undefined);
  const gain = {
    gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
    connect: vi.fn()
  };

  globalThis.AudioContext = class {
    constructor() {
      this.currentTime = 10;
      this.destination = {};
      this.close = close;
    }

    createGain() {
      return gain;
    }

    createOscillator() {
      const oscillator = {
        connect: vi.fn(),
        frequency: { value: 0 },
        onended: null,
        start: vi.fn(),
        stop: vi.fn()
      };
      oscillators.push(oscillator);
      return oscillator;
    }
  };

  const timeout = vi.spyOn(globalThis, "setTimeout");
  playParticipantJoinedSound();

  expect(oscillators).toHaveLength(2);
  expect(timeout).not.toHaveBeenCalled();
  expect(close).not.toHaveBeenCalled();
  expect(oscillators[1].onended).toBeTypeOf("function");

  oscillators[1].onended();
  await Promise.resolve();
  expect(close).toHaveBeenCalledTimes(1);
  expect(oscillators[1].onended).toBeNull();
});

test("notification sound stays optional when Web Audio is unavailable or fails", () => {
  expect(() => playParticipantJoinedSound()).not.toThrow();
  globalThis.AudioContext = class {
    constructor() {
      throw new Error("audio unavailable");
    }
  };
  expect(() => playParticipantJoinedSound()).not.toThrow();
});
