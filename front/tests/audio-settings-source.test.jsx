/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { same, verify } from "./helpers/assertions.mjs";
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
vi.mock("../src/contexts/AppDialog", () => ({ useAppDialog: () => ({ alert: mocks.alert }) }));
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
vi.mock("../src/hooks/usePolling", () => ({ usePolling: mocks.usePolling }));
vi.mock("../src/utils/audio-preferences", () => ({
  getAudioPreferences: mocks.getAudioPreferences,
  saveAudioPreferences: mocks.saveAudioPreferences
}));
import {
  getSignalLevel,
  nextMonitorLevel,
  resolveMonitorTarget,
  stopStream
} from "../src/pages/Settings/audio-source.js";
import useAudioSettingsSource from "../src/pages/Settings/audio-source.js";
import { translateSaved } from "../src/i18n/runtime.js";
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
    { audio_driver: "auto", monitoring_enabled: false, volume: 0.8, input_device_id: 1 },
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
  Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: undefined });
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  delete globalThis.AudioContext;
  delete globalThis.webkitAudioContext;
  delete HTMLMediaElement.prototype.setSinkId;
});
// A running AudioContext whose gain/oscillator node calls aren't individually
// asserted on by the test using it -- only its overall shape matters.
function installRunningFakeAudioContext() {
  globalThis.AudioContext = class {
    state = "running";
    currentTime = 0;
    close = vi.fn();
    createMediaStreamDestination = () => ({ stream: { getTracks: () => [] } });
    createGain = () => ({
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn()
    });
    createOscillator = () => ({
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    });
  };
}
describe("audio settings source", () => {
  test("normalizes signal levels and monitor decay at exact boundaries", () => {
    same([getSignalLevel({ rms_db: -30, rms_dbfs: -60 }), 50], [getSignalLevel({ rms_db: 0, rms_dbfs: -60 }), 100], [getSignalLevel({ rms_dbfs: -60 }), 0], [getSignalLevel({ rms_db: -90 }), 0], [getSignalLevel({ rms_db: 12 }), 100], [getSignalLevel({ rms_db: "invalid" }), 0], [getSignalLevel(null), 0], [resolveMonitorTarget(false, true, 0.8, { rms_db: 0 }), 0], [resolveMonitorTarget(true, false, 0.8, { rms_db: 0 }), 0], [resolveMonitorTarget(true, true, 0.25, { rms_db: -30 }), 50], [resolveMonitorTarget(true, true, 0.8, { rms_db: -30 }), 80], [nextMonitorLevel(50, 50, 100, 200), 50], [nextMonitorLevel(50, 50, 200, 100), 50], [nextMonitorLevel(50, 120, 100, 200), 100], [nextMonitorLevel(50, 40, 100, 200), 50], [nextMonitorLevel(50, 40, 200, 200), 39], [nextMonitorLevel(1, 0, 200, 100), 0]);
    verify([nextMonitorLevel(0.8 / 0.78, 0, 200, 100), 'toBeCloseTo', 0.8], [nextMonitorLevel(2, 0, 200, 100), 'toBe', 1.56]);
  });
  test("stops every track of an existing media stream", () => {
    stopStream(null);
    const tracks = [{ stop: vi.fn() }, { stop: vi.fn() }];
    stopStream({ getTracks: () => tracks });
    tracks.forEach(({ stop }) => expect(stop).toHaveBeenCalledOnce());
  });
  test("maps runtime values and available device options", async () => {
    const { result } = renderHook(() => useAudioSettingsSource());
    verify([result.current.values, 'toMatchObject', { audio_driver: "auto", input_device_id: 1, output_device_id: "", asio_driver_name: "", buffer_size: 64, volume: 0.8 }]);
    verify([result.current.options.inputDevices, 'toHaveLength', 2], [result.current.options.outputDevices, 'toHaveLength', 2]);
    verify([result.current.options.outputDevices[0].label, 'toBe', translateSaved("Системное устройство")]);
    expect(result.current.options.asioDrivers).toEqual([ { value: "Driver", label: "Driver" } ]);
    verify([result.current.options.audioDrivers, 'toEqual', [ { value: "auto", label: translateSaved("Автоматически · рекомендуется") }, { value: "asio", label: translateSaved("ASIO · для аудиоинтерфейсов") } ]]);
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
    const { result } = renderHook(() => useAudioSettingsSource({ enabled: false })
    );
    const fetchers = mocks.usePolling.mock.calls.map(([fetcher]) => fetcher);
    verify([mocks.usePolling.mock.calls.map(([, interval]) => interval), 'toEqual', [0, 0, 0, 0, 0]]);
    verify([mocks.usePolling.mock.calls.map(([, , deps]) => deps), 'toEqual', [ [false, mocks.getAudioSettings], [false, mocks.listAudioDevices], [false, mocks.listAudioOutputDevices], [false, mocks.listAsioDrivers], [false, mocks.getSignalQuality] ]]);
    await expect(fetchers[0]()).resolves.toBeNull();
    await expect(fetchers[1]()).resolves.toEqual([]);
    await expect(fetchers[2]()).resolves.toEqual([]);
    await expect(fetchers[3]()).resolves.toEqual([]);
    await expect(fetchers[4]()).resolves.toBeNull();
    verify([result.current.states.monitorLevel, 'toBe', 0], [mocks.stopSpeakingMeter, 'toHaveBeenCalledWith', "local"]);
  });
  test("updates backend, refreshes state and reports failures", async () => {
    const changed = vi.fn();
    window.addEventListener("audio-settings-changed", changed);
    mocks.updateAudioSettings.mockResolvedValueOnce({ volume: 0.5 });
    const { result } = renderHook(() => useAudioSettingsSource());
    await expect( result.current.updateBackend({ volume: 0.5 })
    ).resolves.toEqual({ ok: true, value: { volume: 0.5 } });
    expect(changed).toHaveBeenCalledOnce();
    verify([changed.mock.calls[0][0], 'toMatchObject', { type: "audio-settings-changed", detail: { volume: 0.5 } }]);
    expect(mocks.refresh).toHaveBeenCalledOnce();
    const error = new Error("offline");
    mocks.updateAudioSettings.mockRejectedValueOnce(error);
    const failed = await result.current.updateBackend({ volume: 0.4 });
    expect(failed).toEqual({ ok: false, error });
    expect(mocks.alert).toHaveBeenCalledWith(
      `${translateSaved("Не удалось сохранить аудионастройки")}: offline`
    );
    expect(mocks.refresh).toHaveBeenCalledOnce();
    mocks.updateAudioSettings.mockResolvedValueOnce({ volume: 0.3 });
    const dispatch = vi
      .spyOn(globalThis, "dispatchEvent")
      .mockImplementationOnce(() => { throw new Error("unsupported event target"); });
    await expect( result.current.updateBackend({ volume: 0.3 })
    ).resolves.toEqual({ ok: true, value: { volume: 0.3 } });
    expect(mocks.refresh).toHaveBeenCalledTimes(2);
    dispatch.mockRestore();
    window.removeEventListener("audio-settings-changed", changed);
  });
  test("persists local audio preferences", async () => {
    mocks.updateUiPreferences.mockRejectedValueOnce(new Error("optional"));
    const { result } = renderHook(() => useAudioSettingsSource());
    act(() => result.current.updatePreference("monitorInputDeviceId", "mic"));
    expect(mocks.saveAudioPreferences).toHaveBeenCalledWith({ monitorInputDeviceId: "mic" });
    verify([result.current.preferences, 'toEqual', { monitorInputDeviceId: "mic", monitorOutputDeviceId: "default" }]);
    verify([mocks.updateUiPreferences, 'toHaveBeenCalledWith', "audio", { monitorInputDeviceId: "mic", monitorOutputDeviceId: "default" }]);
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
          { kind: "audioinput", deviceId: "unnamed-mic", label: "" },
          { kind: "audiooutput", deviceId: "speaker", label: "Speaker" },
          { kind: "audiooutput", deviceId: "unnamed-output", label: "" }
        ]),
        getUserMedia
      }
    });
    mocks.getAudioPreferences.mockReturnValue({
      monitorInputDeviceId: "mic",
      monitorOutputDeviceId: "default"
    });
    pollingData[0] = { monitoring_enabled: true };
    const addEvent = vi.spyOn(globalThis, "addEventListener");
    const removeEvent = vi.spyOn(globalThis, "removeEventListener");
    const { result, unmount } = renderHook(() => useAudioSettingsSource());
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    verify([getUserMedia.mock.calls, 'toEqual', [ [ { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, deviceId: { exact: "mic" } } } ], [ { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } } ] ]]);
    verify([mocks.prepareSpeakingMeter, 'toHaveBeenCalled'], [mocks.startSpeakingMeter, 'toHaveBeenCalledWith', "local", stream]);
    expect(result.current.options.browserInputs).toContainEqual({ value: "mic", label: "Mic" });
    verify([result.current.options.browserInputs.find( ({ value }) => value === "unnamed-mic" ).label, 'toBe', translateSaved("Микрофон")]);
    verify([result.current.options.browserOutputs.find( ({ value }) => value === "unnamed-output" ).label, 'toBe', translateSaved("Аудиоустройство")]);
    const unlockRegistrations = addEvent.mock.calls.filter(([event]) =>
      ["pointerdown", "keydown"].includes(event)
    );
    verify([unlockRegistrations, 'toHaveLength', 2], [unlockRegistrations.map(([event]) => event), 'toEqual', [ "pointerdown", "keydown" ]]);
    unlockRegistrations.forEach(([, , options]) => expect(options).toEqual({ once: true })
    );
    window.dispatchEvent(new Event("keydown"));
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    unmount();
    expect(track.stop).toHaveBeenCalled();
    const unlockRemovals = removeEvent.mock.calls.filter(([event]) =>
      ["pointerdown", "keydown"].includes(event)
    );
    verify([unlockRemovals, 'toHaveLength', 2], [unlockRemovals.map(([event]) => event), 'toEqual', [ "pointerdown", "keydown" ]]);
    unlockRemovals.forEach(([, listener]) => expect(listener).toBe(unlockRegistrations[0][1])
    );
  });
  test("ignores optional browser-device enumeration failures", async () => {
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices: vi.fn().mockRejectedValue(new Error("blocked")) }
    });
    renderHook(() => useAudioSettingsSource());
    await act(async () => Promise.resolve());
    expect(navigator.mediaDevices.enumerateDevices).toHaveBeenCalled();
  });
  test("ignores device enumeration completed after unmount", async () => {
    let resolveDevices;
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn( () => new Promise((resolve) => { resolveDevices = resolve; })
        )
      }
    });
    const hook = renderHook(() => useAudioSettingsSource());
    await waitFor(() => expect(resolveDevices).toBeTypeOf("function"));
    hook.unmount();
    await act(async () => resolveDevices([]));
  });
  test("starts and clears browser discovery when enabled changes", async () => {
    const enumerateDevices = vi
      .fn()
      .mockResolvedValue([ { kind: "audioinput", deviceId: "late-mic", label: "Late mic" } ]);
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { enumerateDevices }
    });
    const hook = renderHook(
      ({ enabled }) => useAudioSettingsSource({ enabled }),
      { initialProps: { enabled: false } }
    );
    expect(enumerateDevices).not.toHaveBeenCalled();
    hook.rerender({ enabled: true });
    await waitFor(() => expect(enumerateDevices).toHaveBeenCalledOnce());
    await waitFor(() =>
      expect(hook.result.current.options.browserInputs).toContainEqual({
        value: "late-mic",
        label: "Late mic"
      })
    );
    hook.rerender({ enabled: false });
    expect(hook.result.current.options.browserInputs).toHaveLength(1);
  });
  test("handles unavailable and late microphone streams", async () => {
    pollingData[0] = { monitoring_enabled: true };
    const failedMedia = vi.fn().mockRejectedValue(new Error("denied"));
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: failedMedia }
    });
    const failed = renderHook(() => useAudioSettingsSource());
    await waitFor(() => expect(failedMedia).toHaveBeenCalledOnce());
    verify([failedMedia.mock.calls, 'toEqual', [ [ { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1 } } ] ]]);
    window.dispatchEvent(new Event("pointerdown"));
    await waitFor(() => expect(failedMedia.mock.calls.length).toBeGreaterThan(1)
    );
    failed.unmount();
    let resolveStream;
    const stop = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: { getUserMedia: vi.fn( () => new Promise((resolve) => { resolveStream = resolve; }) ) }
    });
    pollingIndex = 0;
    const pending = renderHook(() => useAudioSettingsSource());
    await waitFor(() => expect(resolveStream).toBeTypeOf("function"));
    pending.unmount();
    await act(async () => resolveStream({ getTracks: () => [{ stop }] }));
    expect(stop).toHaveBeenCalled();
  });
  test("does not report a microphone start after immediate unmount", async () => {
    pollingData[0] = { monitoring_enabled: true };
    const hook = renderHook(() => useAudioSettingsSource());
    mocks.stopSpeakingMeter.mockClear();
    hook.unmount();
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledOnce();
    await act(async () => Promise.resolve());
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledOnce();
  });
  test("does not treat a late microphone rejection as a started stream", async () => {
    pollingData[0] = { monitoring_enabled: true };
    let rejectMedia;
    const getUserMedia = vi.fn( () => new Promise((_resolve, reject) => { rejectMedia = reject; })
    );
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const hook = renderHook(() => useAudioSettingsSource());
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    mocks.stopSpeakingMeter.mockClear();
    hook.unmount();
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledOnce();
    await act(async () => rejectMedia(new Error("late denial")));
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledOnce();
  });
  test("restarts monitoring with a newly selected browser microphone", async () => {
    pollingData[0] = { monitoring_enabled: true };
    const firstTrack = { stop: vi.fn() };
    const secondTrack = { stop: vi.fn() };
    const getUserMedia = vi
      .fn()
      .mockResolvedValueOnce({ getTracks: () => [firstTrack] })
      .mockResolvedValueOnce({ getTracks: () => [secondTrack] });
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const hook = renderHook(() => useAudioSettingsSource());
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    act(() => hook.result.current.updatePreference("monitorInputDeviceId", "new-mic")
    );
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    verify([getUserMedia, 'toHaveBeenLastCalledWith', { audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false, channelCount: 1, deviceId: { exact: "new-mic" } } }]);
    expect(firstTrack.stop).toHaveBeenCalled();
    hook.unmount();
    expect(secondTrack.stop).toHaveBeenCalled();
  });
  test("stops a stale microphone when device requests resolve in reverse order", async () => {
    pollingData[0] = { monitoring_enabled: true };
    let resolveFirst, resolveSecond;
    const firstTrack = { stop: vi.fn() };
    const secondTrack = { stop: vi.fn() };
    const getUserMedia = vi.fn()
      .mockReturnValueOnce(new Promise((resolve) => { resolveFirst = resolve; }))
      .mockReturnValueOnce(new Promise((resolve) => { resolveSecond = resolve; }));
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const hook = renderHook(() => useAudioSettingsSource());
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledOnce());
    act(() => hook.result.current.updatePreference("monitorInputDeviceId", "new-mic"));
    await waitFor(() => expect(getUserMedia).toHaveBeenCalledTimes(2));
    await act(async () => resolveSecond({ getTracks: () => [secondTrack] }));
    await act(async () => resolveFirst({ getTracks: () => [firstTrack] }));
    verify([firstTrack.stop, 'toHaveBeenCalled'], [secondTrack.stop, 'not.toHaveBeenCalled']);
    hook.unmount();
    expect(secondTrack.stop).toHaveBeenCalled();
  });
  test("uses the latest speaking-meter stop callback", () => {
    const firstStop = mocks.stopSpeakingMeter;
    const hook = renderHook(() => useAudioSettingsSource({ enabled: false }));
    expect(firstStop).toHaveBeenCalledWith("local");
    const latestStop = vi.fn();
    mocks.stopSpeakingMeter = latestStop;
    hook.rerender();
    expect(latestStop).toHaveBeenCalledWith("local");
  });
  test("does not start local monitoring while the source is disabled", async () => {
    pollingData[0] = { monitoring_enabled: true };
    const getUserMedia = vi.fn();
    Object.defineProperty(navigator, "mediaDevices", { configurable: true, value: { getUserMedia } });
    const addEvent = vi.spyOn(globalThis, "addEventListener");
    renderHook(() => useAudioSettingsSource({ enabled: false }));
    await act(async () => Promise.resolve());
    expect(getUserMedia).not.toHaveBeenCalled();
    verify([addEvent.mock.calls.filter(([event]) => ["pointerdown", "keydown"].includes(event) ), 'toEqual', []]);
  });
  test("toggles direct monitoring in both directions", async () => {
    mocks.startDirectMonitoring.mockResolvedValue({ enabled: true });
    const off = renderHook(() => useAudioSettingsSource());
    mocks.prepareSpeakingMeter.mockClear();
    mocks.stopSpeakingMeter.mockClear();
    await expect(off.result.current.actions.toggleMonitoring()).resolves.toBe( true
    );
    expect(mocks.startDirectMonitoring).toHaveBeenCalledOnce();
    expect(mocks.prepareSpeakingMeter).toHaveBeenCalledOnce();
    expect(mocks.stopSpeakingMeter).not.toHaveBeenCalled();
    off.unmount();
    pollingData[0] = { monitoring_enabled: true };
    pollingIndex = 0;
    mocks.stopDirectMonitoring.mockResolvedValue({ enabled: false });
    const on = renderHook(() => useAudioSettingsSource());
    mocks.prepareSpeakingMeter.mockClear();
    mocks.stopSpeakingMeter.mockClear();
    await expect(on.result.current.actions.toggleMonitoring()).resolves.toBe( true
    );
    expect(mocks.stopDirectMonitoring).toHaveBeenCalledOnce();
    expect(mocks.prepareSpeakingMeter).not.toHaveBeenCalled();
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledOnce();
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledWith("local");
  });
  test("stops local monitoring when the backend toggle fails", async () => {
    mocks.startDirectMonitoring.mockRejectedValue(new Error("busy"));
    const { result } = renderHook(() => useAudioSettingsSource());
    mocks.stopSpeakingMeter.mockClear();
    await expect(result.current.actions.toggleMonitoring()).resolves.toBe( false
    );
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledOnce();
    expect(mocks.stopSpeakingMeter).toHaveBeenCalledWith("local");
    expect(mocks.alert).toHaveBeenCalledWith(
      `${translateSaved("Не удалось изменить прослушивание")}: busy`
    );
    pollingData[0] = { monitoring_enabled: true };
    pollingIndex = 0;
    mocks.stopDirectMonitoring.mockRejectedValue(new Error("stop busy"));
    const enabled = renderHook(() => useAudioSettingsSource());
    mocks.stopSpeakingMeter.mockClear();
    await expect( enabled.result.current.actions.toggleMonitoring()
    ).resolves.toBe(false);
    expect(mocks.stopSpeakingMeter).not.toHaveBeenCalled();
    expect(mocks.alert).toHaveBeenLastCalledWith(
      `${translateSaved("Не удалось изменить прослушивание")}: stop busy`
    );
    enabled.unmount();
  });
  test("holds, decays and resets the monitoring meter", () => {
    vi.useFakeTimers();
    pollingData[0] = { monitoring_enabled: true };
    pollingData[4] = { rms_db: -30 };
    const setInterval = vi.spyOn(globalThis, "setInterval");
    const clearInterval = vi.spyOn(globalThis, "clearInterval");
    const hook = renderHook(
      ({ enabled }) => useAudioSettingsSource({ enabled }),
      { initialProps: { enabled: true } }
    );
    expect(setInterval).toHaveBeenCalledTimes(1);
    same([setInterval.mock.calls[0][1], 50], [hook.result.current.states.monitorLevel, 0]);
    act(() => vi.advanceTimersByTime(50));
    expect(hook.result.current.states.monitorLevel).toBe(50);
    mocks.speakingLevel = 0;
    pollingData[4] = { rms_db: -60 };
    hook.rerender({ enabled: true });
    act(() => vi.advanceTimersByTime(150));
    expect(hook.result.current.states.monitorLevel).toBe(50);
    act(() => vi.advanceTimersByTime(50));
    expect(hook.result.current.states.monitorLevel).toBe(39);
    pollingData[0] = { monitoring_enabled: false };
    hook.rerender({ enabled: true });
    verify([hook.result.current.states.monitorLevel, 'toBe', 0], [clearInterval, 'toHaveBeenCalled'], [setInterval, 'toHaveBeenCalledTimes', 1]);
    pollingData[0] = { monitoring_enabled: true };
    hook.rerender({ enabled: false });
    act(() => vi.advanceTimersByTime(500));
    verify([hook.result.current.states.monitorLevel, 'toBe', 0], [setInterval, 'toHaveBeenCalledTimes', 1]);
  });
  test("uses empty option lists when backend discovery returns null", () => {
    pollingData[0] = null;
    pollingData[1] = null;
    pollingData[2] = null;
    pollingData[3] = null;
    const { result } = renderHook(() => useAudioSettingsSource());
    verify([result.current.values, 'toMatchObject', { input_device_id: "", output_device_id: "", asio_driver_name: "", buffer_size: 64 }]);
    verify([result.current.options.inputDevices, 'toHaveLength', 1], [result.current.options.outputDevices, 'toHaveLength', 1], [result.current.options.asioDrivers, 'toEqual', []]);
    verify([result.current.options.audioDrivers.map(({ value }) => value), 'toEqual', ["auto"]]);
  });
  test("plays a routed speaker test and releases all resources", async () => {
    vi.useFakeTimers();
    const clearTimeout = vi.spyOn(globalThis, "clearTimeout");
    const stop = vi.fn();
    const close = vi.fn();
    const resume = vi.fn();
    let contextOptions;
    const gain = {
      gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
      connect: vi.fn()
    };
    const oscillator = {
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    };
    globalThis.AudioContext = class {
      constructor(options) {
        contextOptions = options;
      }
      state = "suspended";
      currentTime = 1;
      resume = resume;
      close = close;
      createMediaStreamDestination = () => ({ stream: { getTracks: () => [{ stop }] } });
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
    const createElement = document.createElement.bind(document);
    let audio;
    vi.spyOn(document, "createElement").mockImplementation((tag, options) => {
      const element = createElement(tag, options);
      if (tag === "audio") audio = element;
      return element;
    });
    const { result, unmount } = renderHook(() => useAudioSettingsSource());
    let testPromise;
    act(() => { testPromise = result.current.actions.testSpeakers(); });
    expect(result.current.states.speakerTestState).toBe("playing");
    await act(async () => vi.advanceTimersByTimeAsync(1050));
    await act(() => testPromise);
    expect(contextOptions).toEqual({ latencyHint: "interactive" });
    expect(resume).toHaveBeenCalledOnce();
    expect(sink).toHaveBeenCalledWith("speakers");
    expect(play).toHaveBeenCalledOnce();
    verify([audio.volume, 'toBe', 1], [gain.gain.setValueAtTime.mock.calls, 'toEqual', [ [0.0001, 1], [0.14, 1.55] ]]);
    verify([gain.gain.exponentialRampToValueAtTime.mock.calls, 'toEqual', [ [0.14, 1.04], [0.0001, 1.85] ]]);
    verify([oscillator.type, 'toBe', "sine"], [oscillator.frequency.setValueAtTime.mock.calls, 'toEqual', [ [523.25, 1], [659.25, 1.42] ]], [oscillator.connect, 'toHaveBeenCalledWith', gain]);
    expect(gain.connect).toHaveBeenCalledOnce();
    expect(oscillator.start).toHaveBeenCalledOnce();
    verify([oscillator.stop, 'toHaveBeenCalledWith', 1.9], [result.current.states.speakerTestState, 'toBe', "success"]);
    expect(pause).toHaveBeenCalledOnce();
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    act(() => vi.advanceTimersByTime(1799));
    expect(result.current.states.speakerTestState).toBe("success");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.states.speakerTestState).toBe("idle");
    const clearCalls = clearTimeout.mock.calls.length;
    unmount();
    expect(clearTimeout).toHaveBeenCalledTimes(clearCalls + 1);
    expect(clearTimeout).toHaveBeenLastCalledWith(null);
  });
  test("does not start a second speaker test while one is playing", async () => {
    let releasePlay;
    installRunningFakeAudioContext();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
      () =>
        new Promise((resolve) => { releasePlay = resolve; })
    );
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const hook = renderHook(() => useAudioSettingsSource());
    let first;
    act(() => { first = hook.result.current.actions.testSpeakers(); });
    await waitFor(() => expect(releasePlay).toBeTypeOf("function"));
    await expect( hook.result.current.actions.testSpeakers()
    ).resolves.toBeUndefined();
    const immediateTimeout = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => { callback(); return 1; });
    releasePlay();
    await act(async () => first);
    immediateTimeout.mockRestore();
  });
  test("uses the Web Audio fallback without routing the default output", async () => {
    vi.useFakeTimers();
    const close = vi.fn();
    const sink = vi.fn();
    const oscillator = {
      frequency: { setValueAtTime: vi.fn() },
      connect: vi.fn(),
      start: vi.fn(),
      stop: vi.fn()
    };
    globalThis.webkitAudioContext = class {
      state = "running";
      currentTime = 0;
      close = close;
      createMediaStreamDestination = () => ({ stream: { getTracks: () => [] } });
      createGain = () => ({
        gain: { setValueAtTime: vi.fn(), exponentialRampToValueAtTime: vi.fn() },
        connect: vi.fn()
      });
      createOscillator = () => oscillator;
    };
    Object.defineProperty(HTMLMediaElement.prototype, "setSinkId", {
      configurable: true,
      value: sink
    });
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const hook = renderHook(() => useAudioSettingsSource());
    let promise;
    act(() => { promise = hook.result.current.actions.testSpeakers(); });
    await act(async () => vi.advanceTimersByTimeAsync(1050));
    await act(() => promise);
    verify([sink, 'not.toHaveBeenCalled'], [oscillator.stop, 'toHaveBeenCalledWith', 0.9]);
    expect(close).toHaveBeenCalledOnce();
  });
  test("keeps speaker testing available when output routing is unsupported", async () => {
    vi.useFakeTimers();
    mocks.getAudioPreferences.mockReturnValue({
      monitorInputDeviceId: "default",
      monitorOutputDeviceId: "speakers"
    });
    installRunningFakeAudioContext();
    vi.spyOn(HTMLMediaElement.prototype, "play").mockResolvedValue(undefined);
    vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(() => {});
    const hook = renderHook(() => useAudioSettingsSource());
    let promise;
    act(() => { promise = hook.result.current.actions.testSpeakers(); });
    await act(async () => vi.advanceTimersByTimeAsync(1050));
    await act(() => promise);
    verify([hook.result.current.states.speakerTestState, 'toBe', "success"], [mocks.alert, 'not.toHaveBeenCalled']);
  });
  test("reports speaker-test runtime failures", async () => {
    vi.useFakeTimers();
    globalThis.AudioContext = class {
      constructor() {
        throw new Error("audio context failed");
      }
    };
    const { result } = renderHook(() => useAudioSettingsSource());
    await act(() => result.current.actions.testSpeakers());
    verify([mocks.alert, 'toHaveBeenCalledWith', translateSaved("Не удалось проверить динамики: {0}", { 0: "audio context failed" })]);
    expect(result.current.states.speakerTestState).toBe("error");
    act(() => vi.advanceTimersByTime(1799));
    expect(result.current.states.speakerTestState).toBe("error");
    act(() => vi.advanceTimersByTime(1));
    expect(result.current.states.speakerTestState).toBe("idle");
  });
  test("reports unavailable speaker testing", async () => {
    const { result } = renderHook(() => useAudioSettingsSource());
    await act(() => result.current.actions.testSpeakers());
    verify([mocks.alert, 'toHaveBeenCalledWith', translateSaved("Не удалось запустить проверку звука.")]);
    expect(result.current.states.speakerTestState).toBe("idle");
  });
});
