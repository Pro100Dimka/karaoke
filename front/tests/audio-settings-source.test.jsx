/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  alert: vi.fn(),
  refresh: vi.fn(),
  usePolling: vi.fn(),
  getAudioSettings: vi.fn(),
  listAudioDevices: vi.fn(),
  listAudioOutputDevices: vi.fn(),
  listAsioDrivers: vi.fn(),
  getSignalQuality: vi.fn(),
  updateAudioSettings: vi.fn(),
  updateUiPreferences: vi.fn(),
  startDirectMonitoring: vi.fn(),
  stopDirectMonitoring: vi.fn(),
  prepareSpeakingMeter: vi.fn(),
  startSpeakingMeter: vi.fn(),
  stopSpeakingMeter: vi.fn(),
  getAudioPreferences: vi.fn(),
  saveAudioPreferences: vi.fn(),
  speakingLevel: 0.5
}));

vi.mock("../src/api/client", () => ({
  api: {
    getAudioSettings: mocks.getAudioSettings,
    listAudioDevices: mocks.listAudioDevices,
    listAudioOutputDevices: mocks.listAudioOutputDevices,
    listAsioDrivers: mocks.listAsioDrivers,
    getSignalQuality: mocks.getSignalQuality,
    updateAudioSettings: mocks.updateAudioSettings,
    updateUiPreferences: mocks.updateUiPreferences,
    startDirectMonitoring: mocks.startDirectMonitoring,
    stopDirectMonitoring: mocks.stopDirectMonitoring
  }
}));
vi.mock("../src/contexts/AppDialog", () => ({
  useAppDialog: () => ({ alert: mocks.alert })
}));
vi.mock("../src/contexts/hooks/useSpeakingLevels", () => ({
  default: () => ({
    localSpeakingLevel: mocks.speakingLevel,
    prepareSpeakingMeter: mocks.prepareSpeakingMeter,
    startSpeakingMeter: mocks.startSpeakingMeter,
    stopSpeakingMeter: mocks.stopSpeakingMeter
  })
}));
vi.mock("../src/hooks/useAsyncQueue", () => ({
  default: () => ({ pending: false, run: (action) => action() })
}));
vi.mock("../src/hooks/useExclusiveAsyncAction", () => ({
  default: () => ({ pending: false, run: (action) => action() })
}));
vi.mock("../src/hooks/usePolling", () => ({
  usePolling: mocks.usePolling
}));
vi.mock("../src/utils/audio-preferences", () => ({
  getAudioPreferences: mocks.getAudioPreferences,
  saveAudioPreferences: mocks.saveAudioPreferences
}));

import useAudioSettingsSource from "../src/pages/Settings/audio-source.js";

let pollingData;
let pollingIndex;

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock?.mockReset?.());
  mocks.speakingLevel = 0.5;
  mocks.alert.mockResolvedValue(undefined);
  mocks.refresh.mockResolvedValue(undefined);
  mocks.updateUiPreferences.mockResolvedValue({});
  mocks.getAudioPreferences.mockReturnValue({
    monitorInputDeviceId: "default",
    monitorOutputDeviceId: "default"
  });
  mocks.saveAudioPreferences.mockImplementation((patch) => ({
    monitorInputDeviceId: "default",
    monitorOutputDeviceId: "default",
    ...patch
  }));
  pollingData = [
    {
      audio_driver: "auto",
      monitoring_enabled: false,
      volume: 0.8,
      input_device_id: 1
    },
    [{ index: 1, name: "Input" }],
    [{ index: 2, name: "Output" }],
    [{ name: "Driver" }],
    { rms_db: -30 }
  ];
  pollingIndex = 0;
  mocks.usePolling.mockImplementation(() => ({
    data: pollingData[pollingIndex++ % 5],
    refresh: mocks.refresh
  }));
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined
  });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  delete HTMLMediaElement.prototype.setSinkId;
});

describe("audio settings source", () => {
  test("maps runtime values and available device options", async () => {
    const { result } = renderHook(() => useAudioSettingsSource());
    expect(result.current.values).toMatchObject({
      audio_driver: "auto",
      input_device_id: 1,
      output_device_id: "",
      asio_driver_name: "",
      buffer_size: 64,
      volume: 0.8
    });
    expect(result.current.options.inputDevices).toHaveLength(2);
    expect(result.current.options.outputDevices).toHaveLength(2);
    expect(result.current.options.asioDrivers).toEqual([
      { value: "Driver", label: "Driver" }
    ]);
    expect(
      result.current.options.audioDrivers.map(({ value }) => value)
    ).toEqual(["auto", "asio"]);
    for (const [fetcher] of mocks.usePolling.mock.calls.slice(0, 5)) {
      await fetcher();
    }
    expect(mocks.getAudioSettings).toHaveBeenCalledOnce();
    expect(mocks.listAudioDevices).toHaveBeenCalledOnce();
    expect(mocks.listAudioOutputDevices).toHaveBeenCalledOnce();
    expect(mocks.listAsioDrivers).toHaveBeenCalledOnce();
    expect(mocks.getSignalQuality).toHaveBeenCalledOnce();
  });

  test("disables polling work and browser devices when inactive", async () => {
    const { result } = renderHook(() =>
      useAudioSettingsSource({ enabled: false })
    );
    const fetchers = mocks.usePolling.mock.calls.map(([fetcher]) => fetcher);
    await expect(fetchers[0]()).resolves.toBeNull();
    await expect(fetchers[1]()).resolves.toEqual([]);
    await expect(fetchers[2]()).resolves.toEqual([]);
    await expect(fetchers[3]()).resolves.toEqual([]);
    await expect(fetchers[4]()).resolves.toBeNull();
    expect(result.current.states.monitorLevel).toBe(0);
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledWith("local");
  });

  test("updates backend, refreshes state and reports failures", async () => {
    const changed = vi.fn();
    window.addEventListener("audio-settings-changed", changed);
    mocks.updateAudioSettings.mockResolvedValueOnce({ volume: 0.5 });
    const { result } = renderHook(() => useAudioSettingsSource());
    await expect(
      result.current.updateBackend({ volume: 0.5 })
    ).resolves.toEqual({
      ok: true,
      value: { volume: 0.5 }
    });
    expect(changed).toHaveBeenCalledOnce();
    expect(mocks.refresh).toHaveBeenCalled();

    mocks.updateAudioSettings.mockRejectedValueOnce(new Error("offline"));
    const failed = await result.current.updateBackend({ volume: 0.4 });
    expect(failed.ok).toBe(false);
    expect(mocks.alert).toHaveBeenCalledWith(
      expect.stringContaining("offline")
    );
    mocks.updateAudioSettings.mockResolvedValueOnce({ volume: 0.3 });
    const dispatch = vi
      .spyOn(globalThis, "dispatchEvent")
      .mockImplementationOnce(() => {
        throw new Error("unsupported event target");
      });
    await expect(
      result.current.updateBackend({ volume: 0.3 })
    ).resolves.toEqual({
      ok: true,
      value: { volume: 0.3 }
    });
    dispatch.mockRestore();
    window.removeEventListener("audio-settings-changed", changed);
  });

  test("persists local audio preferences", async () => {
    mocks.updateUiPreferences.mockRejectedValueOnce(new Error("optional"));
    const { result } = renderHook(() => useAudioSettingsSource());
    act(() => result.current.updatePreference("monitorInputDeviceId", "mic"));
    expect(result.current.preferences.monitorInputDeviceId).toBe("mic");
    expect(mocks.updateUiPreferences).toHaveBeenCalledWith(
      "audio",
      expect.objectContaining({ monitorInputDeviceId: "mic" })
    );
    await act(async () => Promise.resolve());
  });

  test("enumerates browser devices and starts the selected microphone", async () => {
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] };
    const getUserMedia = vi
      .fn()
      .mockRejectedValueOnce(new Error("specific unavailable"))
      .mockResolvedValueOnce(stream);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          { kind: "audioinput", deviceId: "mic", label: "Mic" },
          { kind: "audiooutput", deviceId: "speaker", label: "Speaker" }
        ]),
        getUserMedia
      }
    });
    mocks.getAudioPreferences.mockReturnValue({
      monitorInputDeviceId: "mic",
      monitorOutputDeviceId: "default"
    });
    pollingData[0] = { monitoring_enabled: true };
    const { result, unmount } = renderHook(() => useAudioSettingsSource());
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    expect(mocks.prepareSpeakingMeter).toHaveBeenCalled();
    expect(mocks.startSpeakingMeter).toHaveBeenCalledWith("local", stream);
    expect(result.current.options.browserInputs.at(-1).value).toBe("mic");
    unmount();
    expect(track.stop).toHaveBeenCalled();
  });

  test("handles unavailable and late microphone streams", async () => {
    pollingData[0] = { monitoring_enabled: true };
    const failedMedia = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: failedMedia }
    });
    const failed = renderHook(() => useAudioSettingsSource());
    await waitFor(() => expect(failedMedia).toHaveBeenCalled());
    window.dispatchEvent(new Event("pointerdown"));
    await waitFor(() =>
      expect(failedMedia.mock.calls.length).toBeGreaterThan(1)
    );
    failed.unmount();

    let resolveStream;
    const stop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        getUserMedia: vi.fn(
          () =>
            new Promise((resolve) => {
              resolveStream = resolve;
            })
        )
      }
    });
    pollingIndex = 0;
    const pending = renderHook(() => useAudioSettingsSource());
    await waitFor(() => expect(resolveStream).toBeTypeOf("function"));
    pending.unmount();
    await act(async () => resolveStream({ getTracks: () => [{ stop }] }));
    expect(stop).toHaveBeenCalled();
  });

  test("toggles direct monitoring in both directions", async () => {
    mocks.startDirectMonitoring.mockResolvedValue({ enabled: true });
    const off = renderHook(() => useAudioSettingsSource());
    await expect(off.result.current.actions.toggleMonitoring()).resolves.toBe(
      true
    );
    expect(mocks.startDirectMonitoring).toHaveBeenCalledOnce();
    off.unmount();

    pollingData[0] = { monitoring_enabled: true };
    pollingIndex = 0;
    mocks.stopDirectMonitoring.mockResolvedValue({ enabled: false });
    const on = renderHook(() => useAudioSettingsSource());
    await expect(on.result.current.actions.toggleMonitoring()).resolves.toBe(
      true
    );
    expect(mocks.stopDirectMonitoring).toHaveBeenCalledOnce();
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledWith("local");
  });

  test("stops local monitoring when the backend toggle fails", async () => {
    mocks.startDirectMonitoring.mockRejectedValue(new Error("busy"));
    const { result } = renderHook(() => useAudioSettingsSource());
    await expect(result.current.actions.toggleMonitoring()).resolves.toBe(
      false
    );
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledWith("local");
    expect(mocks.alert).toHaveBeenCalledWith(expect.stringContaining("busy"));
  });

  test("animates the monitoring meter", () => {
    vi.useFakeTimers();
    pollingData[0] = { monitoring_enabled: true };
    const hook = renderHook(() => useAudioSettingsSource());
    act(() => vi.advanceTimersByTime(50));
    expect(hook.result.current.states.monitorLevel).toBe(50);

    mocks.speakingLevel = 0;
    pollingData[4] = null;
    hook.rerender();
    act(() => vi.advanceTimersByTime(500));
    expect(hook.result.current.states.monitorLevel).toBeLessThan(50);
  });

  test("plays a routed speaker test and releases all resources", async () => {
    const stop = vi.fn();
    const close = vi.fn();
    const resume = vi.fn();
    const gain = {
      gain: {
        setValueAtTime: vi.fn(),
        exponentialRampToValueAtTime: vi.fn()
      },
      connect: vi.fn()
    };
    const oscillator = {
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    };
    globalThis.AudioContext = class {
      state = "suspended";
      currentTime = 1;
      resume = resume;
      close = close;
      createMediaStreamDestination = () => ({
        stream: { getTracks: () => [{ stop }] }
      });
      createGain = () => gain;
      createOscillator = () => oscillator;
    };
    const play = vi
      .spyOn(HTMLMediaElement.prototype, "play")
      .mockResolvedValue(undefined);
    const pause = vi
      .spyOn(HTMLMediaElement.prototype, "pause")
      .mockImplementation(() => {});
    const sink = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: sink
    });
    mocks.getAudioPreferences.mockReturnValue({
      monitorInputDeviceId: "default",
      monitorOutputDeviceId: "speakers"
    });
    const immediateTimeout = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => {
        callback();
        return 1;
      });
    const { result } = renderHook(() => useAudioSettingsSource());
    await act(() => result.current.actions.testSpeakers());
    expect(resume).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith("speakers");
    expect(play).toHaveBeenCalled();
    expect(oscillator.start).toHaveBeenCalledOnce();
    expect(pause).toHaveBeenCalled();
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    immediateTimeout.mockRestore();
  });

  test("does not start a second speaker test while one is playing", async () => {
    let releasePlay;
    globalThis.AudioContext = class {
      state = "running";
      currentTime = 0;
      close = vi.fn();
      createMediaStreamDestination = () => ({
        stream: { getTracks: () => [] }
      });
      createGain = () => ({
        gain: {
          setValueAtTime: vi.fn(),
          exponentialRampToValueAtTime: vi.fn()
        },
        connect: vi.fn()
      });
      createOscillator = () => ({
        frequency: { setValueAtTime: vi.fn() },
        connect: vi.fn(),
        start: vi.fn(),
        stop: vi.fn()
      });
    };
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
      () =>
        new Promise((resolve) => {
          releasePlay = resolve;
        })
    );
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const hook = renderHook(() => useAudioSettingsSource());
    let first;
    act(() => {
      first = hook.result.current.actions.testSpeakers();
    });
    await waitFor(() => expect(releasePlay).toBeTypeOf("function"));
    await expect(
      hook.result.current.actions.testSpeakers()
    ).resolves.toBeUndefined();
    const immediateTimeout = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => {
        callback();
        return 1;
      });
    releasePlay();
    await act(async () => first);
    immediateTimeout.mockRestore();
  });

  test("reports speaker-test runtime failures", async () => {
    globalThis.AudioContext = class {
      constructor() {
        throw new Error("audio context failed");
      }
    };
    const immediateTimeout = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => {
        callback();
        return 1;
      });
    const { result } = renderHook(() => useAudioSettingsSource());
    await act(() => result.current.actions.testSpeakers());
    expect(mocks.alert).toHaveBeenCalledWith(
      expect.stringContaining("audio context failed")
    );
    immediateTimeout.mockRestore();
  });

  test("reports unavailable speaker testing", async () => {
    const { result } = renderHook(() => useAudioSettingsSource());
    await act(() => result.current.actions.testSpeakers());
    expect(mocks.alert).toHaveBeenCalledOnce();
    expect(result.current.states.speakerTestState).toBe("idle");
  });
});
