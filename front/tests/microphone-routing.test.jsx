/* @vitest-environment jsdom */
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateAudioSettings: vi.fn(),
  releaseDirectMonitoring: vi.fn(),
  getAudioPreferences: vi.fn()
}));
vi.mock("../src/api/client", () => ({ api: mocks }));
vi.mock("../src/hooks/useAsyncQueue", () => ({
  default: () => ({ run: (action) => action() })
}));
vi.mock("../src/utils/audio-preferences", () => ({
  getAudioPreferences: mocks.getAudioPreferences
}));

import useAudioOutputRouting from "../src/pages/Karaoke/hooks/useAudioOutputRouting.js";
import useMicrophoneSettings from "../src/pages/Karaoke/hooks/useMicrophoneSettings.js";

beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset());
  mocks.releaseDirectMonitoring.mockResolvedValue(undefined);
  mocks.getAudioPreferences.mockReturnValue({
    monitorInputDeviceId: "default"
  });
  Object.defineProperty(navigator, "mediaDevices", {
    configurable: true,
    value: undefined
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("microphone settings", () => {
  test("normalizes backend settings and reacts to global changes", () => {
    const onError = vi.fn();
    const hook = renderHook(
      ({ settings }) =>
        useMicrophoneSettings({ audioSettings: settings, onError }),
      {
        initialProps: {
          settings: {
            volume: 0.6,
            audio_driver: "asio",
            output_device_id: 3,
            monitoring_enabled: true,
            reverb: 0.2,
            echo: 0.3,
            delay: 0.4
          }
        }
      }
    );
    expect(hook.result.current).toMatchObject({
      microphoneVolume: 0.6,
      audioDriver: "asio",
      directOutputDeviceId: 3,
      monitoringEnabled: true,
      microphoneEffects: { reverb: 0.2, echo: 0.3, delay: 0.4 }
    });
    act(() =>
      window.dispatchEvent(
        new CustomEvent("audio-settings-changed", {
          detail: {
            volume: 0.2,
            audio_driver: "auto",
            output_device_id: 4,
            monitoring_enabled: false
          }
        })
      )
    );
    expect(hook.result.current).toMatchObject({
      microphoneVolume: 0.2,
      audioDriver: "auto",
      directOutputDeviceId: 4,
      monitoringEnabled: false
    });
    act(() =>
      window.dispatchEvent(
        new CustomEvent("audio-preferences-changed", {
          detail: { monitorInputDeviceId: "mic" }
        })
      )
    );
    expect(hook.result.current.monitorInputDeviceId).toBe("mic");
    act(() => window.dispatchEvent(new CustomEvent("audio-settings-changed")));
  });

  test("updates settings and reports backend failures", async () => {
    const onError = vi.fn();
    mocks.updateAudioSettings.mockResolvedValueOnce({ volume: 0.75 });
    const { result } = renderHook(() =>
      useMicrophoneSettings({ audioSettings: null, onError })
    );
    await act(() => result.current.updateMicrophone({ volume: 0.7 }));
    expect(result.current.microphoneVolume).toBe(0.75);
    mocks.updateAudioSettings.mockRejectedValueOnce(new Error("device busy"));
    await expect(
      result.current.updateMicrophone({ volume: 0.4 })
    ).resolves.toBeNull();
    expect(onError).toHaveBeenCalledWith(
      expect.stringContaining("device busy")
    );
  });

  test("uses stored input preference when an event omits details", () => {
    mocks.getAudioPreferences
      .mockReturnValueOnce({ monitorInputDeviceId: "initial" })
      .mockReturnValueOnce({ monitorInputDeviceId: "fallback" });
    const { result } = renderHook(() =>
      useMicrophoneSettings({ audioSettings: null, onError: vi.fn() })
    );
    act(() =>
      window.dispatchEvent(new CustomEvent("audio-preferences-changed"))
    );
    expect(result.current.monitorInputDeviceId).toBe("fallback");
  });
});

const mediaRef = (setSinkId = vi.fn().mockResolvedValue(undefined)) => ({
  current: { setSinkId }
});

describe("audio output routing", () => {
  test("selects an ASIO output and routes browser media to the matching sink", async () => {
    const setDirectOutputDeviceId = vi.fn();
    const updateMicrophone = vi.fn().mockResolvedValue({});
    const instrumentalRef = mediaRef();
    const vocalsRef = mediaRef();
    const videoRef = mediaRef();
    Object.defineProperty(navigator, "mediaDevices", {
      configurable: true,
      value: {
        enumerateDevices: vi.fn().mockResolvedValue([
          {
            kind: "audiooutput",
            deviceId: "browser-output",
            label: "Focusrite USB"
          }
        ])
      }
    });
    const options = {
      audioDriver: "asio",
      audioSettings: { asio_driver_name: "Focusrite ASIO" },
      browserMonitorRef: { current: null },
      directOutputDeviceId: "",
      directOutputDevices: [{ index: 2, name: "Focusrite USB", is_asio: true }],
      instrumentalRef,
      microphoneOpen: true,
      setDirectOutputDeviceId,
      updateMicrophone,
      videoRef,
      vocalsRef
    };
    const hook = renderHook((props) => useAudioOutputRouting(props), {
      initialProps: options
    });
    expect(setDirectOutputDeviceId).toHaveBeenCalledWith(2);
    expect(updateMicrophone).toHaveBeenCalledWith({ output_device_id: 2 });

    hook.rerender({ ...options, directOutputDeviceId: 2 });
    await waitFor(() =>
      expect(instrumentalRef.current.setSinkId).toHaveBeenCalledWith(
        "browser-output"
      )
    );
    expect(vocalsRef.current.setSinkId).toHaveBeenCalledWith("browser-output");
    expect(videoRef.current.setSinkId).toHaveBeenCalledWith("browser-output");
  });

  test("releases browser and backend monitoring on shutdown", async () => {
    const stop = vi.fn();
    const close = vi.fn().mockResolvedValue(undefined);
    const browserMonitorRef = {
      current: {
        stream: { getTracks: () => [{ stop }] },
        context: { state: "running", close }
      }
    };
    const hook = renderHook(() =>
      useAudioOutputRouting({
        audioDriver: "auto",
        audioSettings: {},
        browserMonitorRef,
        directOutputDeviceId: "",
        directOutputDevices: [],
        instrumentalRef: { current: null },
        microphoneOpen: false,
        setDirectOutputDeviceId: vi.fn(),
        updateMicrophone: vi.fn(),
        videoRef: { current: null },
        vocalsRef: { current: null }
      })
    );
    window.dispatchEvent(new Event("pagehide"));
    expect(mocks.releaseDirectMonitoring).toHaveBeenCalledOnce();
    hook.unmount();
    expect(stop).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
    expect(browserMonitorRef.current).toBeNull();
    await act(async () => Promise.resolve());
  });
});
