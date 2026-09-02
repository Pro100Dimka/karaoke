/* @vitest-environment jsdom */
import { act, render } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { AUDIO_SETTINGS_CHANGED_EVENT } from "../src/utils/audioSettingsEvents";

const mocks = vi.hoisted(() => ({
  getAudioSettings: vi.fn(),
  acquireMicrophone: vi.fn()
}));
vi.mock("../src/api/client", () => ({ api: { getAudioSettings: mocks.getAudioSettings } }));
vi.mock("../src/services/microphoneCapture", () => ({ acquireMicrophone: mocks.acquireMicrophone }));

let LowLatencyMicMonitor;
const flush = async () => {
  await act(async () => Promise.resolve());
  await act(async () => Promise.resolve());
};

beforeEach(async () => {
  vi.resetModules();
  ({ default: LowLatencyMicMonitor } = await import("../src/components/LowLatencyMicMonitor"));
  mocks.getAudioSettings.mockReset().mockResolvedValue({ audio_driver: "auto", monitoring_enabled: false });
  mocks.acquireMicrophone.mockReset();
});
afterEach(() => vi.restoreAllMocks());

describe("low latency mic monitor", () => {
  test("only acquires the mic and enables Web Audio monitoring for the low-latency driver while enabled", async () => {
    const setMonitoring = vi.fn();
    const release = vi.fn();
    mocks.acquireMicrophone.mockResolvedValue({ setMonitoring, release });
    mocks.getAudioSettings.mockResolvedValue({ audio_driver: "auto-low-latency", monitoring_enabled: true });

    render(<LowLatencyMicMonitor />);
    await flush();

    expect(mocks.acquireMicrophone).toHaveBeenCalledWith("", { disabledEffects: false });
    expect(setMonitoring).toHaveBeenCalledWith(true);
  });

  test("does not touch the microphone for the regular driver, even with monitoring enabled", async () => {
    mocks.getAudioSettings.mockResolvedValue({ audio_driver: "auto", monitoring_enabled: true });
    render(<LowLatencyMicMonitor />);
    await flush();
    expect(mocks.acquireMicrophone).not.toHaveBeenCalled();
  });

  test("stops monitoring and releases the lease once the setting changes away from low-latency", async () => {
    // This is the whole point of the feature: it must never keep holding the
    // mic in Web Audio monitoring mode once it's no longer the active driver,
    // or it would fight the online room's own capture for the device.
    const setMonitoring = vi.fn();
    const release = vi.fn();
    mocks.acquireMicrophone.mockResolvedValue({ setMonitoring, release });
    mocks.getAudioSettings.mockResolvedValue({ audio_driver: "auto-low-latency", monitoring_enabled: true });

    render(<LowLatencyMicMonitor />);
    await flush();
    expect(setMonitoring).toHaveBeenCalledWith(true);

    act(() => {
      window.dispatchEvent(
        new CustomEvent(AUDIO_SETTINGS_CHANGED_EVENT, {
          detail: { audio_driver: "auto-low-latency", monitoring_enabled: false }
        })
      );
    });
    await flush();

    expect(setMonitoring).toHaveBeenCalledWith(false);
    expect(release).toHaveBeenCalledOnce();
  });
});
