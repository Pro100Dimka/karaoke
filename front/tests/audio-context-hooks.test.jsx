/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import useApplicationAudioMute from "../src/contexts/hooks/useApplicationAudioMute.js";
import useSpeakingLevels from "../src/contexts/hooks/useSpeakingLevels.js";
import { same, verify } from "./helpers/assertions.mjs";

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
    const { result, unmount } = renderHook(() => useApplicationAudioMute(false));
    act(() => result.current.muteApplicationAudio(document));
    expect([normal.muted, alreadyMuted.muted, room.muted]).toEqual([true, true, false]);
    act(() => result.current.muteApplicationAudio(normal));
    act(() => result.current.muteApplicationAudio({}));
    const detached = document.createElement("audio");
    document.body.append(detached);
    act(() => result.current.muteApplicationAudio(detached));
    detached.remove();
    act(() => result.current.restoreApplicationAudio());
    verify([[normal.muted, alreadyMuted.muted], "toEqual", [false, true]], [detached.muted, "toBe", true]);
    act(() => result.current.muteApplicationAudio(null));
    unmount();
  });
  test("mutes a detached audio root and restores manual muting on unmount", () => {
    const detached = document.createElement("audio");
    const { result, unmount } = renderHook(() => useApplicationAudioMute(false));
    act(() => result.current.muteApplicationAudio(detached));
    expect(detached.muted).toBe(true);
    document.body.append(detached);
    unmount();
    expect(detached.muted).toBe(false);
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
    document.body.append("status", container);
    await waitFor(() => expect(inserted.muted).toBe(true));
    hook.rerender({ enabled: false });
    same([existing.muted, false], [inserted.muted, false]);
  });
  test("observes audio inserted into an already connected subtree", async () => {
    const container = document.createElement("section");
    document.body.append(container);
    const hook = renderHook(() => useApplicationAudioMute(true));
    const inserted = document.createElement("audio");
    container.append(inserted);
    await waitFor(() => expect(inserted.muted).toBe(true));
    hook.unmount();
    expect(inserted.muted).toBe(false);
  });
  test("forgets a muted element's original state once it's removed from the DOM", async () => {
    // Regression test: without this, originalMuteStateRef kept one entry
    // per <audio>/<video> element that ever got muted while room-sound
    // mute was on, even after the element was removed (e.g. KaraokeMedia
    // remounting a fresh <audio> per song) -- pinning detached DOM nodes in
    // memory for as long as the toggle stayed on.
    const container = document.createElement("section");
    document.body.append(container);
    const removed = document.createElement("audio");
    container.append(removed);
    const deleteSpy = vi.spyOn(Map.prototype, "delete");
    const hook = renderHook(() => useApplicationAudioMute(true));
    await waitFor(() => expect(removed.muted).toBe(true));
    deleteSpy.mockClear();

    removed.remove();
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(removed));

    hook.unmount();
    deleteSpy.mockRestore();
  });
  test("restores audio without mutation observer support", () => {
    const audio = document.createElement("audio");
    document.body.append(audio);
    vi.stubGlobal("MutationObserver", undefined);
    const hook = renderHook(() => useApplicationAudioMute(true));
    expect(audio.muted).toBe(true);
    hook.unmount();
    expect(audio.muted).toBe(false);
    vi.unstubAllGlobals();
  });
});
class FakeTrack extends EventTarget {
  readyState = "live";
  constructor() {
    super();
    this.addEventListener = vi.fn(super.addEventListener.bind(this));
    this.removeEventListener = vi.fn(super.removeEventListener.bind(this));
  }
}
function installAudioContext({ sample = 255, state = "running", resumeError, resumeThrows, closeError } = {}) {
  const trackNodes = [];
  class FakeAudioContext {
    constructor(options) {
      this.options = options;
      this.state = state;
      this.resume = vi.fn(() => {
        if (resumeThrows) throw resumeThrows;
        if (resumeError) return Promise.reject(resumeError);
        this.state = "running";
      });
      this.close = vi.fn(() => {
        if (closeError) return Promise.reject(closeError);
        this.state = "closed";
      });
      this.source = { connect: vi.fn(), disconnect: vi.fn() };
      this.analyser = {
        fftSize: 0,
        smoothingTimeConstant: 0,
        disconnect: vi.fn(),
        getByteTimeDomainData: vi.fn((samples) => samples.fill(typeof sample === "function" ? sample() : sample))
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
const streamWith = (track) => ({ getAudioTracks: () => (track ? [track] : []) });
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
    same([result.current.localSpeakingLevel, 0.54], [result.current.speakingLevels.guest, 0.54]);
    verify([contexts[0].source.connect, "toHaveBeenCalled"], [contexts[0].options, "toEqual", { latencyHint: "interactive" }]);
    verify([remoteTrack.addEventListener, "toHaveBeenCalledWith", "ended", expect.any(Function), { once: true }]);
    act(() => remoteTrack.dispatchEvent(new Event("ended")));
    expect(result.current.speakingLevels.guest).toBeUndefined();
    verify([remoteTrack.removeEventListener, "toHaveBeenCalledWith", "ended", expect.any(Function)]);
    act(() => result.current.stopSpeakingMeter("missing"));
    act(() => result.current.stopAllSpeakingMeters());
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
    const runningContexts = installAudioContext();
    const running = renderHook(() => useSpeakingLevels());
    act(() => running.result.current.startSpeakingMeter("x", null));
    act(() => running.result.current.startSpeakingMeter("x", {}));
    expect(runningContexts).toHaveLength(0);
    verify(
      [running.result.current.prepareSpeakingMeter(), "toBe", true],
      [runningContexts[0].resume, "not.toHaveBeenCalled"],
      [runningContexts, "toHaveLength", 1]
    );
    running.unmount();
    const contexts = installAudioContext({ state: "suspended", sample: 128 });
    const suspended = renderHook(() => useSpeakingLevels());
    verify([suspended.result.current.prepareSpeakingMeter(), "toBe", true], [contexts[0].resume, "toHaveBeenCalled"]);
    act(() => suspended.result.current.startSpeakingMeter("x", streamWith(null)));
    const ended = new FakeTrack();
    ended.readyState = "ended";
    act(() => suspended.result.current.startSpeakingMeter("x", streamWith(ended)));
    verify(
      [suspended.result.current.speakingLevels, "toEqual", {}],
      [ended.addEventListener, "not.toHaveBeenCalled"],
      [contexts[0].source.disconnect, "toHaveBeenCalled"]
    );
    suspended.unmount();
  });
  test("stops a meter when sampling fails", () => {
    vi.useFakeTimers();
    const contexts = installAudioContext();
    contexts.length = 0;
    const track = new FakeTrack();
    const hook = renderHook(() => useSpeakingLevels());
    act(() => hook.result.current.startSpeakingMeter("guest", streamWith(track)));
    contexts[0].analyser.getByteTimeDomainData.mockImplementation(() => {
      throw new Error("device removed");
    });
    act(() => vi.advanceTimersByTime(70));
    expect(hook.result.current.speakingLevels).toEqual({});
  });
  test("absorbs asynchronous context resume and close failures", async () => {
    const contexts = installAudioContext({
      state: "suspended",
      resumeError: new Error("resume failed"),
      closeError: new Error("close failed")
    });
    const hook = renderHook(() => useSpeakingLevels());
    expect(hook.result.current.prepareSpeakingMeter()).toBe(true);
    act(() => hook.result.current.stopAllSpeakingMeters());
    await act(async () => Promise.resolve());
    expect(contexts[0].resume).toHaveBeenCalledTimes(2);
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });
  test("does not close an already closed speaking context", () => {
    const contexts = installAudioContext();
    const hook = renderHook(() => useSpeakingLevels());
    hook.result.current.prepareSpeakingMeter();
    contexts[0].state = "closed";
    act(() => hook.result.current.stopAllSpeakingMeters());
    expect(contexts[0].close).not.toHaveBeenCalled();
  });
  test("recovers closed contexts and synchronous Web Audio failures", () => {
    const contexts = installAudioContext();
    const hook = renderHook(() => useSpeakingLevels());
    expect(hook.result.current.prepareSpeakingMeter()).toBe(true);
    contexts[0].state = "closed";
    verify([hook.result.current.prepareSpeakingMeter(), "toBe", true], [contexts, "toHaveLength", 2]);
    hook.unmount();
    globalThis.AudioContext = class {
      constructor() {
        throw new Error("constructor failed");
      }
    };
    const failed = renderHook(() => useSpeakingLevels());
    expect(failed.result.current.prepareSpeakingMeter()).toBe(false);
    act(() => failed.result.current.startSpeakingMeter("guest", streamWith(new FakeTrack())));
  });
  test("rejects synchronous resume and graph-construction failures", () => {
    const contexts = installAudioContext();
    const hook = renderHook(() => useSpeakingLevels());
    expect(hook.result.current.prepareSpeakingMeter()).toBe(true);
    contexts[0].state = "suspended";
    contexts[0].resume
      .mockImplementationOnce(() => undefined)
      .mockImplementationOnce(() => {
        throw new Error("resume failed");
      });
    expect(hook.result.current.prepareSpeakingMeter()).toBe(false);
    contexts[0].state = "running";
    contexts[0].createAnalyser = () => {
      throw new Error("graph failed");
    };
    act(() => hook.result.current.startSpeakingMeter("guest", streamWith(new FakeTrack())));
    expect(contexts[0].source.disconnect).toHaveBeenCalled();
  });
  test("rejects a synchronous initial context resume failure", () => {
    const contexts = installAudioContext({
      state: "suspended",
      resumeThrows: new Error("resume failed")
    });
    const hook = renderHook(() => useSpeakingLevels());
    expect(hook.result.current.prepareSpeakingMeter()).toBe(false);
    expect(contexts[0].resume).toHaveBeenCalledOnce();
  });
  test("keeps other remote levels when one meter is removed", () => {
    vi.useFakeTimers();
    installAudioContext({ sample: 140 });
    const first = new FakeTrack();
    const second = new FakeTrack();
    const hook = renderHook(() => useSpeakingLevels());
    act(() => {
      hook.result.current.startSpeakingMeter("first", streamWith(first));
      hook.result.current.startSpeakingMeter("second", streamWith(second));
      vi.advanceTimersByTime(70);
    });
    expect(hook.result.current.speakingLevels).toEqual({ first: 0.16, second: 0.16 });
    act(() => hook.result.current.stopSpeakingMeter("first"));
    expect(hook.result.current.speakingLevels).toEqual({ second: 0.16 });
    act(() => hook.result.current.stopSpeakingMeter("first"));
    expect(hook.result.current.speakingLevels).toEqual({ second: 0.16 });
  });
  test("publishes only meaningful quantized level changes", () => {
    vi.useFakeTimers();
    const values = [132, 131, 128, 132];
    installAudioContext({ sample: () => values.shift() ?? 132 });
    const hook = renderHook(() => useSpeakingLevels());
    act(() => hook.result.current.startSpeakingMeter("guest", streamWith(new FakeTrack())));
    act(() => vi.advanceTimersByTime(70));
    expect(hook.result.current.speakingLevels.guest).toBe(0.04);
    act(() => vi.advanceTimersByTime(70));
    expect(hook.result.current.speakingLevels.guest).toBe(0.04);
    act(() => hook.result.current.stopSpeakingMeter("guest"));
    act(() => hook.result.current.startSpeakingMeter("boundary", streamWith(new FakeTrack())));
    act(() => vi.advanceTimersByTime(70));
    expect(hook.result.current.speakingLevels.boundary).toBe(0);
    act(() => vi.advanceTimersByTime(70));
    expect(hook.result.current.speakingLevels.boundary).toBe(0.04);
    act(() => hook.result.current.stopSpeakingMeter("boundary"));
    values.push(131);
    act(() => hook.result.current.startSpeakingMeter("quiet", streamWith(new FakeTrack())));
    act(() => vi.advanceTimersByTime(70));
    expect(hook.result.current.speakingLevels.quiet).toBe(0);
  });
  test("stops an active meter when its audio context closes", () => {
    vi.useFakeTimers();
    const contexts = installAudioContext();
    const track = new FakeTrack();
    const hook = renderHook(() => useSpeakingLevels());
    act(() => hook.result.current.startSpeakingMeter("guest", streamWith(track)));
    act(() => vi.advanceTimersByTime(70));
    expect(hook.result.current.speakingLevels.guest).toBe(0.32);
    contexts[0].state = "closed";
    act(() => vi.advanceTimersByTime(70));
    verify([hook.result.current.speakingLevels.guest, "toBeUndefined"], [contexts[0].source.disconnect, "toHaveBeenCalled"]);
  });
  test("unmount stops active speaking meters and closes their context", () => {
    const contexts = installAudioContext();
    const track = new FakeTrack();
    const hook = renderHook(() => useSpeakingLevels());
    act(() => hook.result.current.startSpeakingMeter("guest", streamWith(track)));
    hook.unmount();
    verify([track.removeEventListener, "toHaveBeenCalledWith", "ended", expect.any(Function)]);
    expect(contexts[0].source.disconnect).toHaveBeenCalled();
    expect(contexts[0].close).toHaveBeenCalledOnce();
  });
  test("stops sampling when the input track ends and suppresses tiny deltas", () => {
    vi.useFakeTimers();
    const contexts = installAudioContext({ sample: 128 });
    const track = new FakeTrack();
    const hook = renderHook(() => useSpeakingLevels());
    act(() => hook.result.current.startSpeakingMeter("guest", streamWith(track)));
    act(() => vi.advanceTimersByTime(70));
    act(() => vi.advanceTimersByTime(70));
    expect(hook.result.current.speakingLevels.guest).toBe(0);
    track.readyState = "ended";
    act(() => vi.advanceTimersByTime(70));
    verify([hook.result.current.speakingLevels.guest, "toBeUndefined"], [contexts[0].source.disconnect, "toHaveBeenCalled"]);
  });
});
