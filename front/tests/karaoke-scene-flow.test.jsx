/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import useKaraokeSceneFlow from "../src/pages/Karaoke/hooks/useKaraokeSceneFlow";

const media = () => ({ readyState: 4, load: vi.fn() });
const props = (overrides = {}) => ({
  analysisRecordingIdRef: { current: null }, autoStartRequested: false, hideControls: vi.fn(),
  instrumentalRef: { current: media() }, vocalsRef: { current: null }, isPlaying: false,
  isRadioPlaying: true, navigate: vi.fn(), setRecordingActive: vi.fn(), songId: "song",
  stop: vi.fn().mockResolvedValue(true), togglePlay: vi.fn().mockResolvedValue(false),
  turnOffRadio: vi.fn(), turnOnRadio: vi.fn().mockResolvedValue(true), ...overrides
});

beforeEach(() => vi.useFakeTimers());
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("karaoke scene flow", () => {
  test("propagates failed playback and restores radio after intro", async () => {
    const input = props();
    const hook = renderHook(() => useKaraokeSceneFlow(input));
    let result;
    await act(async () => {
      const pending = hook.result.current.handleTogglePlay().then((value) => { result = value; });
      await vi.runAllTimersAsync();
      await pending;
    });
    expect(result).toBe(false);
    expect(input.turnOffRadio).toHaveBeenCalledWith({ remember: false });
    expect(input.turnOnRadio).toHaveBeenCalledWith({ remember: false, fadeIn: true });
  });
});
