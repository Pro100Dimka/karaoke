/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({ updateUiPreferences: vi.fn() }));
vi.mock("../src/api/client", () => ({ api: mocks }));

let RADIO_STATIONS;
let RadioProvider;
let calculateRadioSpectrum;
let isAutoplayBlocked;
let normalizeRadioSettings;
let useRadio;

const wrapper = ({ children }) => <RadioProvider>{children}</RadioProvider>;
const store = (value) =>
  localStorage.setItem("karaoke-radio", JSON.stringify(value));

beforeEach(async () => {
  vi.resetModules();
  ({
    RADIO_STATIONS,
    RadioProvider,
    calculateRadioSpectrum,
    isAutoplayBlocked,
    normalizeRadioSettings,
    useRadio
  } = await import("../src/contexts/radio.jsx"));
  localStorage.clear();
  store({ stationId: "poptron", volume: 0.45, enabled: false });
  mocks.updateUiPreferences.mockReset().mockResolvedValue({});
  vi.spyOn(HTMLMediaElement.prototype, "load").mockImplementation(() => {});
  vi.spyOn(HTMLMediaElement.prototype, "pause").mockImplementation(
    function pause() {
      Object.defineProperty(this, "paused", { configurable: true, value: true });
    }
  );
  vi.spyOn(HTMLMediaElement.prototype, "play").mockImplementation(
    function play() {
      Object.defineProperty(this, "paused", { configurable: true, value: false });
      return Promise.resolve();
    }
  );
  vi.stubGlobal( "requestAnimationFrame", vi.fn(() => 1)
  );
  vi.stubGlobal("cancelAnimationFrame", vi.fn());
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.documentElement.style.removeProperty("--radio-bass");
  document.documentElement.style.removeProperty("--radio-analysis-active");
  for (let index = 0; index < 18; index += 1)
    document.documentElement.style.removeProperty(`--radio-band-${index}`);
  delete window.AudioContext;
  delete window.webkitAudioContext;
});

describe("radio context", () => {
  test("keeps the complete station catalog contract", () => {
    expect(RADIO_STATIONS).toEqual([
      expect.objectContaining({
        id: "poptron",
        name: "SomaFM PopTron",
        streams: [
          "https://ice5.somafm.com/poptron-128-mp3",
          "https://ice2.somafm.com/poptron-128-mp3"
        ]
      }),
      expect.objectContaining({
        id: "indiepop",
        name: "SomaFM Indie Pop Rocks",
        streams: [
          "https://ice5.somafm.com/indiepop-128-mp3",
          "https://ice2.somafm.com/indiepop-128-mp3"
        ]
      }),
      expect.objectContaining({ id: "beatblender", name: "SomaFM Beat Blender" }),
      expect.objectContaining({ id: "groovesalad", name: "SomaFM Groove Salad" })
    ]);
    RADIO_STATIONS.forEach(({ description, streams }) => {
      expect(description).not.toBe("");
      expect(streams).toHaveLength(2);
    });
  });

  test("normalizes settings and classifies autoplay failures", () => {
    expect(normalizeRadioSettings()).toEqual({ enabled: true, stationId: "poptron", volume: 0.1 });
    expect( normalizeRadioSettings({ stationId: "indiepop", volume: -1, enabled: false })
    ).toEqual({ enabled: false, stationId: "indiepop", volume: 0 });
    expect(isAutoplayBlocked({ name: "NotAllowedError" })).toBe(true);
    expect(isAutoplayBlocked({ message: "user didn't interact" })).toBe(true);
    expect(isAutoplayBlocked("not allowed by browser")).toBe(true);
    expect(isAutoplayBlocked(null)).toBe(false);
    expect(isAutoplayBlocked(new Error("offline"))).toBe(false);
  });

  test("calculates deterministic attack, decay and frequency bands", () => {
    const data = Uint8Array.from( { length: 64 }, (_, index) => (index * 7) % 256
    );
    const result = calculateRadioSpectrum(
      data,
      48000,
      2048,
      0.2,
      Array.from({ length: 18 }, (_, index) => index / 40)
    );
    expect(result.bass).toBeCloseTo(0.19082352941176473, 14);
    expect(result.bands).toEqual([
      0.045217254901960775, 0.07832588235294116, 0.11143450980392156,
      0.15584745098039215, 0.2228690196078431, 0.35373607843137256,
      0.46008392156862743, 0.6075094117647059, 0.6639999999999999,
      0.5684728506787331, 0.486435294117647, 0.6955, 0.252, 0.273, 0.294, 0.315,
      0.336, 0.357
    ]);
    const decay = calculateRadioSpectrum( new Uint8Array(64), 48000, 2048, 0.5, Array(18).fill(0.5)
    );
    expect(decay).toEqual({ bands: Array(18).fill(0.42), bass: 0.44 });

    const attack = calculateRadioSpectrum(
      new Uint8Array(1025).fill(50),
      48000,
      2048,
      0,
      Array(18).fill(0)
    );
    expect(attack.bass).toBeCloseTo(0.09019607843137255, 14);
    expect(attack.bands.slice(0, 5)).toEqual( Array(5).fill(0.16149019607843135)
    );
    expect(attack.bands.slice(5, 12)).toEqual( Array(7).fill(0.19560784313725488)
    );
    expect(attack.bands.slice(12)).toEqual(Array(6).fill(0.23313725490196074));

    const lowSampleRate = calculateRadioSpectrum( data, 8000, 2048, 0.2, Array(18).fill(0)
    );
    expect(lowSampleRate.bass).toBeCloseTo(0.32825882352941177, 14);
    expect(lowSampleRate.bands.slice(0, 8)).toEqual([
      0.293912156862745, 0.37304235294117644, 0.4747811764705881, 0.58,
      0.5319487058823529, 0.20343215686274507, 0.5320533333333333, 0.58
    ]);
  });

  test("requires the provider", () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    const suppress = (event) => event.preventDefault();
    window.addEventListener("error", suppress);
    expect(() => renderHook(() => useRadio())).toThrow( "useRadio must be used inside RadioProvider"
    );
    window.removeEventListener("error", suppress);
    log.mockRestore();
  });

  test("normalizes stored settings and exposes station metadata", () => {
    store({ stationId: "unknown", volume: 8, enabled: "yes" });
    const { result } = renderHook(() => useRadio(), { wrapper });
    expect(result.current.stationId).toBe("poptron");
    expect(result.current.volume).toBe(1);
    expect(result.current.stations).toBe(RADIO_STATIONS);
    expect(result.current.getBassLevel()).toBe(0);
    expect(result.current.getSpectrumLevels()).toHaveLength(18);
    cleanup();
    store({ stationId: "poptron", volume: "bad", enabled: false });
    const fallback = renderHook(() => useRadio(), { wrapper });
    expect(fallback.result.current.volume).toBe(0.1);
    expect(fallback.result.current.isPlaying).toBe(false);
    expect(fallback.result.current.isLoading).toBe(false);
    expect(fallback.result.current.error).toBe("");
  });

  test("starts, stops, toggles and persists playback", async () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => { expect(await hook.result.current.turnOn()).toBe(true); });
    expect(hook.result.current.isPlaying).toBe(true);
    expect(document.querySelector("audio").src).toContain("poptron");
    expect(mocks.updateUiPreferences).toHaveBeenCalledWith(
      "radio",
      expect.objectContaining({ enabled: true })
    );
    act(() => hook.result.current.toggle());
    expect(hook.result.current.isPlaying).toBe(false);
    expect(mocks.updateUiPreferences).toHaveBeenLastCalledWith(
      "radio",
      expect.objectContaining({ enabled: false })
    );
    act(() => hook.result.current.toggle());
    await act(async () => Promise.resolve());
    expect(hook.result.current.isPlaying).toBe(true);
  });

  test("exposes pending playback state and applies startup options", async () => {
    let resolvePlay;
    HTMLMediaElement.prototype.play.mockImplementationOnce(
      function playPending() {
        Object.defineProperty(this, "paused", { configurable: true, value: false });
        return new Promise((resolve) => { resolvePlay = resolve; });
      }
    );
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn()
    };
    const context = {
      state: "running",
      sampleRate: 48000,
      destination: {},
      createAnalyser: vi.fn(() => analyser),
      createMediaElementSource: vi.fn(() => ({ connect: vi.fn() })),
      close: vi.fn().mockResolvedValue()
    };
    window.AudioContext = class {
      constructor() {
        return context;
      }
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    fireEvent.error(document.querySelector("audio"));
    expect(hook.result.current.error).not.toBe("");

    let pending;
    act(() => { pending = hook.result.current.turnOn({ remember: false }); });
    expect(hook.result.current.error).toBe("");
    expect(hook.result.current.isLoading).toBe(true);
    expect(document.querySelector("audio").volume).toBe(0.45);
    resolvePlay();
    await act(async () => expect(await pending).toBe(true));
    expect(analyser.getByteFrequencyData).toHaveBeenCalledTimes(1);
    expect(mocks.updateUiPreferences).not.toHaveBeenCalled();

    hook.result.current.turnOff({ remember: false });
    let resolveFade;
    HTMLMediaElement.prototype.play.mockImplementationOnce(
      function playPendingFade() {
        Object.defineProperty(this, "paused", { configurable: true, value: false });
        return new Promise((resolve) => { resolveFade = resolve; });
      }
    );
    act(() => {
      pending = hook.result.current.turnOn({ analyse: false, fadeIn: true, remember: false });
    });
    expect(document.querySelector("audio").volume).toBe(0);
    resolveFade();
    await act(async () => expect(await pending).toBe(true));
    expect(analyser.getByteFrequencyData).toHaveBeenCalledTimes(1);
  });

  test("turning off cancels a pending start immediately", async () => {
    let resolvePlay;
    HTMLMediaElement.prototype.play.mockReturnValueOnce(
      new Promise((resolve) => { resolvePlay = resolve; })
    );
    const hook = renderHook(() => useRadio(), { wrapper });
    let pending;
    act(() => { pending = hook.result.current.turnOn({ analyse: false, remember: false }); });
    expect(hook.result.current.isLoading).toBe(true);
    act(() => hook.result.current.turnOff({ remember: false }));
    expect(hook.result.current.isLoading).toBe(false);
    expect(hook.result.current.isPlaying).toBe(false);
    resolvePlay();
    await expect(pending).resolves.toBe(false);
  });

  test("animates startup volume and isolates preference persistence failures", async () => {
    const frames = [];
    vi.spyOn(performance, "now").mockReturnValue(1000);
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    mocks.updateUiPreferences.mockRejectedValueOnce(new Error("storage"));
    const hook = renderHook(() => useRadio(), { wrapper });
    act(() => hook.result.current.setVolume(0.6));
    await act(async () => {
      expect( await hook.result.current.turnOn({ fadeIn: true, analyse: false })
      ).toBe(true);
    });
    const audio = document.querySelector("audio");
    act(() => frames.at(-1)(2000));
    expect(audio.volume).toBeCloseTo(0.3);
    expect(frames).toHaveLength(2);
    act(() => frames.at(-1)(3000));
    expect(audio.volume).toBeCloseTo(0.6);
    expect(frames).toHaveLength(2);
    expect(cancelAnimationFrame).toHaveBeenCalled();
  });

  test("clamps volume and switches valid stations", async () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    act(() => hook.result.current.setVolume(4));
    expect(hook.result.current.volume).toBe(1);
    expect(mocks.updateUiPreferences).toHaveBeenLastCalledWith(
      "radio",
      expect.objectContaining({ volume: 1 })
    );
    act(() => hook.result.current.setVolume("bad"));
    expect(hook.result.current.volume).toBe(0.1);
    act(() => hook.result.current.setStation("unknown"));
    expect(hook.result.current.stationId).toBe("poptron");
    mocks.updateUiPreferences.mockClear();
    HTMLMediaElement.prototype.load.mockClear();
    HTMLMediaElement.prototype.pause.mockClear();
    act(() => hook.result.current.setStation("poptron"));
    expect(mocks.updateUiPreferences).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();

    await act(() => hook.result.current.turnOn());
    mocks.updateUiPreferences.mockClear();
    act(() => hook.result.current.setStation("indiepop"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.stationId).toBe("indiepop");
    expect(hook.result.current.station.id).toBe("indiepop");
    expect(document.querySelector("audio").src).toContain("indiepop");
    expect(hook.result.current.isPlaying).toBe(true);
    expect(mocks.updateUiPreferences).toHaveBeenCalledWith(
      "radio",
      expect.objectContaining({ stationId: "indiepop" })
    );
    expect(mocks.updateUiPreferences).toHaveBeenCalledTimes(1);
  });

  test("resumes the selected station when switching during loading", async () => {
    let resolveOld;
    HTMLMediaElement.prototype.play.mockReturnValueOnce(
      new Promise((resolve) => { resolveOld = resolve; })
    );
    const hook = renderHook(() => useRadio(), { wrapper });
    let oldPlayback;
    act(() => { oldPlayback = hook.result.current.turnOn({ analyse: false }); });
    expect(hook.result.current.isLoading).toBe(true);
    act(() => hook.result.current.setStation("indiepop"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.station.id).toBe("indiepop");
    expect(hook.result.current.isPlaying).toBe(true);
    expect(document.querySelector("audio").src).toContain("indiepop");
    resolveOld();
    await expect(oldPlayback).resolves.toBe(false);
  });

  test("switches metadata without playback while recording is active", () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    fireEvent.error(document.querySelector("audio"));
    expect(hook.result.current.error).not.toBe("");
    act(() => hook.result.current.setRecordingActive(true));
    HTMLMediaElement.prototype.play.mockClear();
    mocks.updateUiPreferences.mockClear();
    act(() => hook.result.current.setStation("indiepop"));
    expect(hook.result.current.station.id).toBe("indiepop");
    expect(hook.result.current.error).toBe("");
    expect(hook.result.current.isLoading).toBe(false);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    expect(mocks.updateUiPreferences).toHaveBeenCalledTimes(1);
    expect(mocks.updateUiPreferences).toHaveBeenCalledWith(
      "radio",
      expect.objectContaining({ stationId: "indiepop" })
    );
  });

  test("uses the latest station for a later manual start", async () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    act(() => hook.result.current.setStation("indiepop"));
    const audio = document.querySelector("audio");
    audio.removeAttribute("src");
    await act(() => hook.result.current.turnOn({ analyse: false, remember: false })
    );
    expect(audio.src).toContain("indiepop");
  });

  test("suspends radio while recording and resumes afterwards", async () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(() => hook.result.current.turnOn());
    mocks.updateUiPreferences.mockClear();
    act(() => hook.result.current.setRecordingActive(true));
    expect(hook.result.current.isPlaying).toBe(false);
    HTMLMediaElement.prototype.play.mockClear();
    act(() => hook.result.current.setRecordingActive(true));
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    await act(async () => { expect(await hook.result.current.turnOn()).toBe(false); });
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
    act(() => hook.result.current.setRecordingActive(false));
    await act(async () => Promise.resolve());
    expect(hook.result.current.isPlaying).toBe(true);
    expect(mocks.updateUiPreferences).not.toHaveBeenCalled();
    HTMLMediaElement.prototype.play.mockClear();
    act(() => hook.result.current.setRecordingActive(false));
    await act(async () => Promise.resolve());
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  test("ignores redundant recording-state notifications", async () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    mocks.updateUiPreferences.mockClear();
    HTMLMediaElement.prototype.pause.mockClear();
    act(() => hook.result.current.setRecordingActive(false));
    await act(async () => {
      expect( await hook.result.current.turnOn({ analyse: false, remember: false })
      ).toBe(true);
    });
    expect(mocks.updateUiPreferences).not.toHaveBeenCalled();
    act(() => hook.result.current.turnOff({ remember: false }));
    HTMLMediaElement.prototype.pause.mockClear();
    act(() => hook.result.current.setRecordingActive(true));
    expect(HTMLMediaElement.prototype.pause).not.toHaveBeenCalled();
    expect(mocks.updateUiPreferences).not.toHaveBeenCalled();
  });

  test("rejects a start before touching media while suspended", async () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    act(() => hook.result.current.setRecordingActive(true));
    HTMLMediaElement.prototype.load.mockClear();
    HTMLMediaElement.prototype.play.mockClear();
    await expect( hook.result.current.turnOn({ analyse: false, remember: false })
    ).resolves.toBe(false);
    expect(HTMLMediaElement.prototype.load).not.toHaveBeenCalled();
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  test("tries mirror streams and handles blocked startup autoplay", async () => {
    HTMLMediaElement.prototype.play
      .mockRejectedValueOnce(new Error("first mirror failed"))
      .mockResolvedValueOnce(undefined);
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => { expect(await hook.result.current.turnOn()).toBe(true); });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);

    hook.result.current.turnOff({ remember: false });
    const blocked = new Error("user gesture is required");
    blocked.name = "NotAllowedError";
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(blocked);
    await act(async () => {
      expect( await hook.result.current.turnOn({ fadeIn: true, remember: false })
      ).toBe(false);
    });
    expect(hook.result.current.error).toBe("");
    expect(hook.result.current.isPlaying).toBe(false);
    expect(hook.result.current.isLoading).toBe(false);
    window.dispatchEvent(new Event("keydown"));
    await act(async () => Promise.resolve());

    hook.result.current.turnOff({ remember: false });
    HTMLMediaElement.prototype.play.mockRejectedValueOnce( new Error("user gesture required")
    );
    await act(async () => {
      expect( await hook.result.current.turnOn({ fadeIn: true, remember: false })
      ).toBe(false);
    });
  });

  test("treats an autoplay rejection as a mirror failure without fade-in", async () => {
    const blocked = new Error("gesture required");
    blocked.name = "NotAllowedError";
    HTMLMediaElement.prototype.play
      .mockRejectedValueOnce(blocked)
      .mockResolvedValueOnce(undefined);
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect( await hook.result.current.turnOn({ analyse: false, fadeIn: false, remember: false })
      ).toBe(true);
    });
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("keydown"));
    await act(async () => Promise.resolve());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  test("reports exhausted streams and recovers from media errors", async () => {
    const order = [];
    const immediate = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => { order.push("delay"); callback(); return 1; });
    HTMLMediaElement.prototype.play.mockImplementation(() => {
      order.push("play");
      return Promise.reject(new Error("offline"));
    });
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => { expect(await hook.result.current.turnOn()).toBe(false); });
    expect(hook.result.current.error).toContain("offline");
    expect(hook.result.current.isPlaying).toBe(false);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(4);
    expect(immediate).toHaveBeenCalledTimes(1);
    expect(immediate).toHaveBeenCalledWith(expect.any(Function), 500);
    expect(order).toEqual(["play", "play", "delay", "play", "play"]);
    immediate.mockRestore();

    HTMLMediaElement.prototype.play.mockResolvedValue(undefined);
    await act(() => hook.result.current.turnOn());
    mocks.updateUiPreferences.mockClear();
    HTMLMediaElement.prototype.play.mockClear();
    await act(async () => fireEvent.error(document.querySelector("audio")));
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
    expect(mocks.updateUiPreferences).not.toHaveBeenCalled();
  });

  test("reports a media error before any playback attempt", () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    fireEvent.error(document.querySelector("audio"));
    expect(hook.result.current.error).toContain( hook.result.current.station.name
    );
    expect(hook.result.current.isPlaying).toBe(false);
    expect(hook.result.current.isLoading).toBe(false);
  });

  test("builds an analyser graph and clears its visual state", async () => {
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn((data) => data.fill(200))
    };
    const context = {
      state: "suspended",
      sampleRate: 48000,
      destination: {},
      createAnalyser: () => analyser,
      createMediaElementSource: () => ({ connect: vi.fn() }),
      resume: vi.fn().mockResolvedValue(undefined),
      close: vi.fn().mockRejectedValue(new Error("close failed"))
    };
    let constructions = 0;
    window.AudioContext = class {
      constructor() {
        constructions += 1;
        return context;
      }
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await hook.result.current.turnOn({ analyse: true })).toBe(true);
    });
    expect(context.resume).toHaveBeenCalled();
    expect(analyser.getByteFrequencyData).toHaveBeenCalledTimes(1);
    expect(hook.result.current.getBassLevel()).toBeGreaterThan(0);
    expect(hook.result.current.getSpectrumLevels()[0]).toBeGreaterThan(0);
    expect( document.documentElement.style.getPropertyValue("--radio-analysis-active")
    ).toBe("1");
    expect( document.documentElement.style.getPropertyValue("--radio-bass")
    ).toBe(hook.result.current.getBassLevel().toFixed(3));
    expect( document.documentElement.style.getPropertyValue("--radio-band-0")
    ).toBe(hook.result.current.getSpectrumLevels()[0].toFixed(3));
    await act(() => hook.result.current.turnOn({ analyse: true }));
    expect(constructions).toBe(1);
    expect(analyser.getByteFrequencyData).toHaveBeenCalledTimes(2);
    act(() => hook.result.current.turnOff({ remember: false }));
    expect( document.documentElement.style.getPropertyValue("--radio-analysis-active")
    ).toBe("0");
    expect( document.documentElement.style.getPropertyValue("--radio-bass")
    ).toBe("0");
    expect( document.documentElement.style.getPropertyValue("--radio-band-17")
    ).toBe("0");
    expect(hook.result.current.getSpectrumLevels()).toEqual(Array(18).fill(0));
    const audio = document.querySelector("audio");
    HTMLMediaElement.prototype.load.mockClear();
    HTMLMediaElement.prototype.pause.mockClear();
    hook.unmount();
    expect(context.close).toHaveBeenCalled();
    expect(audio.hasAttribute("src")).toBe(false);
    expect(HTMLMediaElement.prototype.pause).toHaveBeenCalledTimes(1);
    expect(HTMLMediaElement.prototype.load).toHaveBeenCalledTimes(1);
  });

  test("handles a silent fade and a fade interrupted by pause", async () => {
    const frames = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const hook = renderHook(() => useRadio(), { wrapper });
    act(() => hook.result.current.setVolume(0));
    const frameCount = frames.length;
    await act(() => hook.result.current.turnOn({ fadeIn: true }));
    const audio = document.querySelector("audio");
    expect(audio.volume).toBe(0);
    expect(frames).toHaveLength(frameCount);
    act(() => hook.result.current.setVolume(0.5));
    await act(() => hook.result.current.turnOn({ fadeIn: true }));
    audio.pause();
    const pausedFrameCount = frames.length;
    act(() => frames.at(-1)(performance.now() + 100));
    expect(audio.paused).toBe(true);
    expect(frames).toHaveLength(pausedFrameCount);
  });

  test("cancels a stale fade whose audio element was detached", async () => {
    const frames = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(() => hook.result.current.turnOn({ fadeIn: true, analyse: false })
    );
    const audio = document.querySelector("audio");
    const staleFrame = frames.at(-1);
    hook.unmount();
    Object.defineProperty(audio, "paused", { configurable: true, value: false });
    const frameCount = frames.length;
    act(() => staleFrame(performance.now() + 100));
    expect(frames).toHaveLength(frameCount);
  });

  test("stops analysis after a browser analyser failure", async () => {
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn(() => { throw new Error("device removed"); })
    };
    const context = {
      state: "running",
      sampleRate: 48000,
      destination: {},
      createAnalyser: () => analyser,
      createMediaElementSource: () => ({ connect: vi.fn() }),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue()
    };
    window.AudioContext = class {
      constructor() {
        return context;
      }
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(() => hook.result.current.turnOn({ analyse: true }));
    expect( document.documentElement.style.getPropertyValue("--radio-analysis-active")
    ).toBe("0");
  });

  test("cancels a pending playback and reports the final media-stream error", async () => {
    let resolvePlay;
    HTMLMediaElement.prototype.play.mockImplementationOnce(
      () =>
        new Promise((resolve) => { resolvePlay = resolve; })
    );
    const hook = renderHook(() => useRadio(), { wrapper });
    const pending = hook.result.current.turnOn();
    fireEvent.error(document.querySelector("audio"));
    expect(hook.result.current.error).toBe("");
    act(() => hook.result.current.turnOff({ remember: false }));
    resolvePlay();
    await expect(pending).resolves.toBe(false);

    HTMLMediaElement.prototype.play.mockResolvedValue(undefined);
    await act(() => hook.result.current.turnOn());
    fireEvent.error(document.querySelector("audio"));
    await act(async () => Promise.resolve());
    fireEvent.error(document.querySelector("audio"));
    await act(async () => Promise.resolve());
    expect(hook.result.current.error).not.toBe("");
  });

  test("reports a generic error when media rejects without a reason", async () => {
    const immediate = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => { callback(); return 1; });
    HTMLMediaElement.prototype.play.mockRejectedValue(undefined);
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => { expect(await hook.result.current.turnOn()).toBe(false); });
    expect(hook.result.current.error).not.toBe("");
    expect(hook.result.current.error).toContain( "No radio stream could be played"
    );
    immediate.mockRestore();
  });

  test("recognizes message-only autoplay blocks and reasonless objects", async () => {
    HTMLMediaElement.prototype.play.mockRejectedValueOnce( new Error("user gesture is required")
    );
    const blocked = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await blocked.result.current.turnOn({ fadeIn: true })).toBe(false);
    });
    blocked.unmount();

    const immediate = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => { callback(); return 1; });
    HTMLMediaElement.prototype.play.mockRejectedValue({});
    const reasonless = renderHook(() => useRadio(), { wrapper });
    await act(async () => { expect(await reasonless.result.current.turnOn()).toBe(false); });
    expect(reasonless.result.current.error).not.toBe("");
    expect(immediate).toHaveBeenCalledTimes(1);
    immediate.mockRestore();

    HTMLMediaElement.prototype.play.mockRejectedValueOnce( "user gesture is required"
    );
    const stringReason = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await stringReason.result.current.turnOn({ fadeIn: true })).toBe( false
      );
    });
    stringReason.unmount();

    const immediateNull = vi
      .spyOn(globalThis, "setTimeout")
      .mockImplementation((callback) => { callback(); return 1; });
    HTMLMediaElement.prototype.play.mockRejectedValue(null);
    const nullReason = renderHook(() => useRadio(), { wrapper });
    await act(async () => {
      expect(await nullReason.result.current.turnOn({ fadeIn: true })).toBe( false
      );
    });
    immediateNull.mockRestore();
  });

  test("unlocks a paused analyser and applies its decay response", async () => {
    const frames = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    let high = true;
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn((data) => data.fill(high ? 220 : 0))
    };
    const context = {
      state: "running",
      sampleRate: 48000,
      destination: {},
      createAnalyser: () => analyser,
      createMediaElementSource: () => ({ connect: vi.fn() }),
      resume: vi.fn(),
      close: vi.fn().mockResolvedValue()
    };
    window.AudioContext = class {
      constructor() {
        return context;
      }
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    window.dispatchEvent(new Event("pointerdown"));
    await act(async () => Promise.resolve());
    expect(analyser.getByteFrequencyData).not.toHaveBeenCalled();
    await act(() => hook.result.current.turnOn({ analyse: true }));
    expect(context.resume).not.toHaveBeenCalled();
    const attack = hook.result.current.getBassLevel();
    high = false;
    act(() => frames.shift()(performance.now()));
    expect(hook.result.current.getBassLevel()).toBeLessThan(attack);
  });

  test("switches stations and recording suspension while stopped", async () => {
    const hook = renderHook(() => useRadio(), { wrapper });
    act(() => hook.result.current.setStation("indiepop"));
    expect(hook.result.current.stationId).toBe("indiepop");
    HTMLMediaElement.prototype.play.mockClear();
    act(() => hook.result.current.setRecordingActive(true));
    act(() => hook.result.current.setRecordingActive(false));
    await act(async () => Promise.resolve());
    expect(hook.result.current.isPlaying).toBe(false);
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();
  });

  test("ignores late blocked and failed playback after unmount", async () => {
    let rejectBlocked;
    HTMLMediaElement.prototype.play.mockReturnValueOnce(
      new Promise((_resolve, reject) => { rejectBlocked = reject; })
    );
    const blockedHook = renderHook(() => useRadio(), { wrapper });
    const blockedPlayback = blockedHook.result.current.turnOn({ fadeIn: true });
    blockedHook.unmount();
    const blocked = new Error("gesture required");
    blocked.name = "NotAllowedError";
    rejectBlocked(blocked);
    await expect(blockedPlayback).resolves.toBe(false);

    let rejectFailed;
    HTMLMediaElement.prototype.play.mockReturnValueOnce(
      new Promise((_resolve, reject) => { rejectFailed = reject; })
    );
    const failedHook = renderHook(() => useRadio(), { wrapper });
    const failedPlayback = failedHook.result.current.turnOn();
    failedHook.unmount();
    rejectFailed(new Error("late"));
    await expect(failedPlayback).resolves.toBe(false);
  });

  test("cancels an older playback before it tries another mirror", async () => {
    let rejectFirst;
    HTMLMediaElement.prototype.play
      .mockImplementationOnce( () => new Promise((_resolve, reject) => { rejectFirst = reject; })
      )
      .mockResolvedValue(undefined);
    const hook = renderHook(() => useRadio(), { wrapper });
    const older = hook.result.current.turnOn();
    const newer = hook.result.current.turnOn();
    await expect(newer).resolves.toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    rejectFirst(new Error("old mirror"));
    await expect(older).resolves.toBe(false);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
  });

  test("does not try another mirror after recording suspension", async () => {
    let rejectPlay;
    HTMLMediaElement.prototype.play.mockReturnValueOnce(
      new Promise((_resolve, reject) => { rejectPlay = reject; })
    );
    const hook = renderHook(() => useRadio(), { wrapper });
    const pending = hook.result.current.turnOn({ analyse: false });
    act(() => hook.result.current.setRecordingActive(true));
    rejectPlay(new Error("offline"));
    await expect(pending).resolves.toBe(false);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });

  test("an obsolete playback cannot clear the newer loading state", async () => {
    let rejectOld;
    let resolveNew;
    HTMLMediaElement.prototype.play
      .mockReturnValueOnce( new Promise((_resolve, reject) => { rejectOld = reject; })
      )
      .mockReturnValueOnce( new Promise((resolve) => { resolveNew = resolve; })
      );
    const hook = renderHook(() => useRadio(), { wrapper });
    let oldPlayback;
    let newPlayback;
    act(() => { oldPlayback = hook.result.current.turnOn({ analyse: false }); });
    act(() => { newPlayback = hook.result.current.turnOn({ analyse: false }); });
    rejectOld(new Error("obsolete"));
    await act(async () => expect(await oldPlayback).toBe(false));
    expect(hook.result.current.isLoading).toBe(true);
    resolveNew();
    await act(async () => expect(await newPlayback).toBe(true));
    expect(hook.result.current.isLoading).toBe(false);
  });

  test("ignores an analyser frame after analysis has stopped", async () => {
    const frames = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn((data) => data.fill(100))
    };
    window.AudioContext = class {
      state = "running";
      sampleRate = 48000;
      destination = {};
      createAnalyser = () => analyser;
      createMediaElementSource = () => ({ connect: vi.fn() });
      resume = vi.fn();
      close = vi.fn().mockResolvedValue();
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(() => hook.result.current.turnOn({ analyse: true }));
    const staleFrame = frames.at(-1);
    act(() => hook.result.current.turnOff({ remember: false }));
    act(() => staleFrame(performance.now()));
    expect(analyser.getByteFrequencyData).toHaveBeenCalledTimes(1);
  });

  test("rebuilds a closed analyser graph and ignores its stale frame", async () => {
    const frames = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const contexts = [];
    window.AudioContext = class {
      constructor() {
        this.state = "running";
        this.sampleRate = 48000;
        this.destination = {};
        this.analyser = {
          fftSize: 0,
          smoothingTimeConstant: 0,
          frequencyBinCount: 32,
          connect: vi.fn(),
          getByteFrequencyData: vi.fn((data) => data.fill(120))
        };
        this.createAnalyser = vi.fn(() => this.analyser);
        this.createMediaElementSource = vi.fn(() => ({ connect: vi.fn() }));
        this.resume = vi.fn();
        this.close = vi.fn().mockResolvedValue();
        contexts.push(this);
      }
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(() => hook.result.current.turnOn({ analyse: true }));
    const staleFrame = frames.at(-1);
    contexts[0].state = "closed";
    act(() => staleFrame(performance.now()));
    expect(contexts[0].analyser.getByteFrequencyData).toHaveBeenCalledTimes(1);

    document.querySelector("audio").pause();
    window.dispatchEvent(new Event("pointerdown"));
    await act(async () => Promise.resolve());
    expect(contexts).toHaveLength(2);
    contexts[0].state = "running";
    act(() => staleFrame(performance.now()));
    expect(contexts[0].analyser.getByteFrequencyData).toHaveBeenCalledTimes(1);
  });

  test("retries startup autoplay on the first user gesture", async () => {
    store({ stationId: "poptron", volume: 0.45, enabled: true });
    const blocked = new Error("gesture required");
    blocked.name = "NotAllowedError";
    let resolveRetry;
    HTMLMediaElement.prototype.play
      .mockRejectedValueOnce(blocked)
      .mockImplementationOnce(function retryPending() {
        Object.defineProperty(this, "paused", { configurable: true, value: false });
        return new Promise((resolve) => { resolveRetry = resolve; });
      });
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn()
    };
    window.AudioContext = class {
      state = "running";
      sampleRate = 48000;
      destination = {};
      createAnalyser = () => analyser;
      createMediaElementSource = () => ({ connect: vi.fn() });
      close = vi.fn().mockResolvedValue();
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => Promise.resolve());
    window.dispatchEvent(new Event("keydown"));
    await act(async () => Promise.resolve());
    expect(document.querySelector("audio").volume).toBe(0);
    window.dispatchEvent(new Event("keydown"));
    await act(async () => Promise.resolve());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    resolveRetry();
    await act(async () => Promise.resolve());
    expect(hook.result.current.isPlaying).toBe(true);
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(analyser.getByteFrequencyData).toHaveBeenCalledTimes(2);
    window.dispatchEvent(new Event("keydown"));
    await act(async () => Promise.resolve());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(2);
    expect(mocks.updateUiPreferences).not.toHaveBeenCalled();
  });

  test("starts enabled radio with analysis but without rewriting preferences", async () => {
    store({ stationId: "poptron", volume: 0.45, enabled: true });
    const analyser = {
      fftSize: 0,
      smoothingTimeConstant: 0,
      frequencyBinCount: 32,
      connect: vi.fn(),
      getByteFrequencyData: vi.fn()
    };
    window.AudioContext = class {
      state = "running";
      sampleRate = 48000;
      destination = {};
      createAnalyser = () => analyser;
      createMediaElementSource = () => ({ connect: vi.fn() });
      close = vi.fn().mockResolvedValue();
    };
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => Promise.resolve());
    expect(hook.result.current.isPlaying).toBe(true);
    expect(document.querySelector("audio").volume).toBe(0);
    expect(analyser.getByteFrequencyData).toHaveBeenCalled();
    expect(mocks.updateUiPreferences).not.toHaveBeenCalled();
  });

  test("removes the keydown autoplay listener on unmount", async () => {
    store({ stationId: "poptron", volume: 0.45, enabled: true });
    const blocked = new Error("gesture required");
    blocked.name = "NotAllowedError";
    HTMLMediaElement.prototype.play.mockRejectedValueOnce(blocked);
    const hook = renderHook(() => useRadio(), { wrapper });
    await act(async () => Promise.resolve());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
    const removeListener = vi.spyOn(window, "removeEventListener");
    hook.unmount();
    expect(removeListener).toHaveBeenCalledWith( "keydown", expect.any(Function), true
    );
    window.dispatchEvent(new Event("keydown"));
    await act(async () => Promise.resolve());
    expect(HTMLMediaElement.prototype.play).toHaveBeenCalledTimes(1);
  });
});
