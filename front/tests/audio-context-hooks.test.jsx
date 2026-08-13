/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

import useApplicationAudioMute from "../src/contexts/hooks/useApplicationAudioMute.js";
import useSpeakingLevels from "../src/contexts/hooks/useSpeakingLevels.js";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
});
beforeEach(() => document.body.replaceChildren());

describe("application audio muting", () => {
  test("mutes application audio, preserves room audio and restores state", () => {
    const normal = document.createElement("audio");
    const alreadyMuted = document.createElement("audio");
    alreadyMuted.muted = true;
    const room = document.createElement("audio");
    room.dataset.onlineRoomParticipant = "guest";
    document.body.append(normal, alreadyMuted, room);

    const { result, unmount } = renderHook(() =>
      useApplicationAudioMute(false)
    );
    act(() => result.current.muteApplicationAudio(document));
    expect([normal.muted, alreadyMuted.muted, room.muted]).toEqual([
      true,
      true,
      false
    ]);
    act(() => result.current.muteApplicationAudio(normal));
    act(() => result.current.restoreApplicationAudio());
    expect([normal.muted, alreadyMuted.muted]).toEqual([false, true]);
    act(() => result.current.muteApplicationAudio(null));
    unmount();
  });

  test("observes audio inserted while muting is enabled", async () => {
    const existing = document.createElement("audio");
    document.body.append(existing);
    const hook = renderHook(({ enabled }) => useApplicationAudioMute(enabled), {
      initialProps: { enabled: true }
    });
    expect(existing.muted).toBe(true);

    const container = document.createElement("div");
    const inserted = document.createElement("audio");
    container.append(inserted);
    document.body.append(container);
    await waitFor(() => expect(inserted.muted).toBe(true));
    hook.rerender({ enabled: false });
    expect(existing.muted).toBe(false);
    expect(inserted.muted).toBe(false);
  });
});

class FakeTrack extends EventTarget {
  readyState = "live";
}

function installAudioContext({ sample = 255, state = "running" } = {}) {
  const trackNodes = [];
  class FakeAudioContext {
    constructor(options) {
      this.options = options;
      this.state = state;
      this.resume = vi.fn(() => {
        this.state = "running";
      });
      this.close = vi.fn(() => {
        this.state = "closed";
      });
      this.source = {
        connect: vi.fn(),
        disconnect: vi.fn()
      };
      this.analyser = {
        fftSize: 0,
        smoothingTimeConstant: 0,
        disconnect: vi.fn(),
        getByteTimeDomainData: vi.fn((samples) => samples.fill(sample))
      };
      trackNodes.push(this);
    }

    createMediaStreamSource() {
      return this.source;
    }

    createAnalyser() {
      return this.analyser;
    }
  }
  globalThis.AudioContext = FakeAudioContext;
  return trackNodes;
}

const streamWith = (track) => ({
  getAudioTracks: () => (track ? [track] : [])
});

describe("speaking level meters", () => {
  test("publishes local and remote levels and removes ended meters", async () => {
    vi.useFakeTimers();
    const contexts = installAudioContext();
    const localTrack = new FakeTrack();
    const remoteTrack = new FakeTrack();
    const { result, unmount } = renderHook(() => useSpeakingLevels());

    act(() => {
      result.current.startSpeakingMeter("local", streamWith(localTrack));
      result.current.startSpeakingMeter("guest", streamWith(remoteTrack));
      vi.advanceTimersByTime(140);
    });
    expect(result.current.localSpeakingLevel).toBeGreaterThan(0);
    expect(result.current.speakingLevels.guest).toBeGreaterThan(0);
    expect(contexts[0].source.connect).toHaveBeenCalled();

    act(() => remoteTrack.dispatchEvent(new Event("ended")));
    expect(result.current.speakingLevels.guest).toBeUndefined();
    act(() => result.current.stopSpeakingMeter("missing"));
    act(() => result.current.stopAllSpeakingMeters());
    expect(result.current.localSpeakingLevel).toBe(0);
    expect(contexts[0].close).toHaveBeenCalledOnce();
    unmount();
    await act(async () => Promise.resolve());
  });

  test("handles unavailable, suspended and invalid audio inputs", () => {
    const unavailable = renderHook(() => useSpeakingLevels());
    expect(unavailable.result.current.prepareSpeakingMeter()).toBe(false);
    act(() => unavailable.result.current.startSpeakingMeter("x", null));
    unavailable.unmount();

    const contexts = installAudioContext({ state: "suspended", sample: 128 });
    const suspended = renderHook(() => useSpeakingLevels());
    expect(suspended.result.current.prepareSpeakingMeter()).toBe(true);
    expect(contexts[0].resume).toHaveBeenCalled();
    act(() =>
      suspended.result.current.startSpeakingMeter("x", streamWith(null))
    );
    const ended = new FakeTrack();
    ended.readyState = "ended";
    act(() =>
      suspended.result.current.startSpeakingMeter("x", streamWith(ended))
    );
    expect(suspended.result.current.speakingLevels).toEqual({});
    suspended.unmount();
  });

  test("stops a meter when sampling fails", () => {
    vi.useFakeTimers();
    const contexts = installAudioContext();
    contexts.length = 0;
    const track = new FakeTrack();
    const hook = renderHook(() => useSpeakingLevels());
    act(() =>
      hook.result.current.startSpeakingMeter("guest", streamWith(track))
    );
    contexts[0].analyser.getByteTimeDomainData.mockImplementation(() => {
      throw new Error("device removed");
    });
    act(() => vi.advanceTimersByTime(70));
    expect(hook.result.current.speakingLevels).toEqual({});
  });
});
