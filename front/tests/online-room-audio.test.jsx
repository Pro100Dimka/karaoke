/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import useOnlineRoomAudio from "../src/contexts/hooks/useOnlineRoomAudio.js";

function createDeferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

class FakeAudioContext {
  constructor() {
    this.destination = {};
    this.sampleRate = 48000;
    this.resumeDeferred = createDeferred();
    this.resume = vi.fn(() => this.resumeDeferred.promise);
    this.close = vi.fn().mockResolvedValue(undefined);
  }
  createMediaStreamSource() {
    return { connect: vi.fn() };
  }
  createGain() {
    return { gain: { value: 0 }, connect: vi.fn() };
  }
  createDelay() {
    return { delayTime: { value: 0 }, connect: vi.fn() };
  }
  createConvolver() {
    return { buffer: null, connect: vi.fn() };
  }
  createBuffer() {
    return { numberOfChannels: 2, getChannelData: () => new Float32Array(10) };
  }
}

function makeHookProps(overrides = {}) {
  return {
    mutedPeopleRef: { current: new Set() },
    roomSoundMutedRef: { current: false },
    roomUiRef: { current: { effectsByParticipant: { peer: { echo: 0.5 } } } },
    participantVolumesRef: { current: {} },
    startSpeakingMeter: vi.fn(),
    stopSpeakingMeter: vi.fn(),
    voiceRef: { current: null },
    ...overrides
  };
}

let contexts;

beforeEach(() => {
  contexts = [];
  globalThis.AudioContext = class extends FakeAudioContext {
    constructor(...args) {
      super(...args);
      contexts.push(this);
    }
  };
  vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete globalThis.AudioContext;
  document.body.replaceChildren();
});

test("removeRemoteAudio forgets the participant's effect-version entry", () => {
  const deleteSpy = vi.spyOn(Map.prototype, "delete");
  const { result } = renderHook(() => useOnlineRoomAudio(makeHookProps()));
  act(() => {
    result.current.attachRemoteStream("peer", { getTracks: () => [] }, vi.fn());
  });
  deleteSpy.mockClear();

  act(() => result.current.removeRemoteAudio("peer"));

  expect(deleteSpy).toHaveBeenCalledWith("peer");
  deleteSpy.mockRestore();
});

test("a pending effect activation is discarded, not attached, once the participant is removed mid-flight", async () => {
  const { result } = renderHook(() => useOnlineRoomAudio(makeHookProps()));
  act(() => {
    result.current.attachRemoteStream("peer", { getTracks: () => [] }, vi.fn());
  });
  act(() => {
    result.current.applyParticipantEffects("peer", true);
  });
  expect(contexts).toHaveLength(1);

  // The participant disconnects (or their effects get toggled again) while
  // this context's resume() is still pending -- deleting the version entry
  // (instead of just bumping it) must still make the eventual activation
  // recognize it's stale and close the context rather than attach it.
  act(() => result.current.removeRemoteAudio("peer"));

  await act(async () => {
    contexts[0].resumeDeferred.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(contexts[0].close).toHaveBeenCalled();
});

test("a fresh activation for the same participant after removal still attaches normally", async () => {
  const { result } = renderHook(() => useOnlineRoomAudio(makeHookProps()));
  act(() => {
    result.current.attachRemoteStream("peer", { getTracks: () => [] }, vi.fn());
  });
  act(() => result.current.removeRemoteAudio("peer"));

  act(() => {
    result.current.attachRemoteStream("peer", { getTracks: () => [] }, vi.fn());
  });
  act(() => {
    result.current.applyParticipantEffects("peer", true);
  });
  await act(async () => {
    contexts[0].resumeDeferred.resolve();
    await Promise.resolve();
    await Promise.resolve();
  });

  expect(contexts[0].close).not.toHaveBeenCalled();
});
