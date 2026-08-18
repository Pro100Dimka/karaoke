/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { same, called, calledWith, verify } from "./helpers/assertions.mjs";
const mocks = vi.hoisted(() => ({
  location: { state: { songId: "song" } },
  navigate: vi.fn(),
  songsPoll: { data: [] },
  listSongs: vi.fn(),
  result: { result: null, loading: false, error: null },
  room: { room: null, participants: [], roomUi: {}, syncUi: vi.fn() },
  radio: {
    isPlaying: false,
    setRecordingActive: vi.fn(),
    toggle: vi.fn(),
    turnOff: vi.fn(),
    turnOn: vi.fn().mockResolvedValue(undefined)
  },
  preferences: null,
  transport: null,
  transportOptions: null,
  controls: null,
  microphone: null,
  consoleProps: null,
  mediaProps: null,
  mediaSyncOptions: null,
  renderMedia: true,
  stageProps: null,
  startMonitoring: vi.fn(),
  stopMonitoring: vi.fn()
}));
vi.mock("react-router-dom", () => ({
  useLocation: () => mocks.location,
  useNavigate: () => mocks.navigate
}));
vi.mock("../src/contexts/OnlineRoomContext", () => ({ useOnlineRoom: () => mocks.room }));
vi.mock("../src/contexts/radio", () => ({ useRadio: () => mocks.radio }));
vi.mock("../src/hooks/usePolling", () => ({
  usePolling: (request) => {
    if (request === mocks.listSongs) return mocks.songsPoll;
    request();
    return { data: null, error: null };
  }
}));
vi.mock("../src/api/client", () => ({
  api: {
    listSongs: mocks.listSongs,
    listAudioOutputDevices: vi.fn(),
    getAudioSettings: vi.fn(),
    getSignalQuality: vi.fn(),
    startDirectMonitoring: mocks.startMonitoring,
    stopDirectMonitoring: mocks.stopMonitoring
  }
}));
vi.mock("../src/components/ui", () => ({
  IconButton: ({ label, onClick, ...props }) => (
    <button aria-label={label} onClick={onClick} {...props} />
  )
}));
vi.mock("../src/pages/Karaoke/components/karaoke-media", () => ({
  default: (props) => {
    mocks.mediaProps = props;
    if (!mocks.renderMedia) return <div data-testid="media" />;
    return (
      <>
        <audio ref={props.instrumentalRef} />
        <audio ref={props.vocalsRef} />
      </>
    );
  }
}));
vi.mock("../src/pages/Karaoke/components/karaoke-performance-stage", () => ({
  default: (props) => {
    mocks.stageProps = props;
    return <div data-testid="stage" />;
  }
}));
vi.mock("../src/pages/Karaoke/components/console", () => ({
  default: (props) => {
    mocks.consoleProps = props;
    return (
      <div data-testid="console">
        <button data-testid="play" onClick={props.onTogglePlay} />
        <button data-testid="stop" onClick={props.onStop} />
        <button
          data-testid="monitor"
          onClick={() => props.onMonitoringChange(true)}
        />
        <button
          data-testid="preset"
          onClick={() =>
            props.onApplyEffectPreset({ id: "hall", reverb: 0.4, echo: 0.2, delay: 0.1 })
          }
        />
        <button
          data-testid="monitor-off"
          onClick={() => props.onMonitoringChange(false)}
        />
        <button
          data-testid="effect"
          onClick={() => props.onEffectChange("echo", 0.6)}
        />
        <button
          data-testid="commit"
          onClick={() => props.onMicrophoneCommit(0.9)}
        />
        <button data-testid="tempo" onClick={() => props.onTempoChange(-200)} />
        <button data-testid="notes" onClick={props.onToggleNotes} />
        <button data-testid="lyrics" onClick={props.onToggleLyrics} />
        <button
          data-testid="auto-hide"
          onClick={() => props.onAutoHideChange(true)}
        />
        <button data-testid="seek" onClick={() => props.onSeek(2)} />
        <button data-testid="skip" onClick={() => props.onSkip(5)} />
      </div>
    );
  }
}));
vi.mock("../src/pages/Karaoke/performance-analysis-modal", () => ({
  default: (props) => (
    <div data-testid="analysis-modal">
      <button data-testid="analysis-close" onClick={props.onClose} />
      <button data-testid="analysis-done" onClick={props.onDone} />
      <button data-testid="analysis-delete" onClick={props.onDeleted} />
    </div>
  )
}));
vi.mock("../src/pages/Karaoke/hooks/useKaraokeResult", () => ({ default: () => mocks.result }));
vi.mock("../src/pages/Karaoke/hooks/useKaraokePreferences", () => ({
  default: () => mocks.preferences
}));
vi.mock("../src/pages/Karaoke/hooks/useKaraokeControls", () => ({ default: () => mocks.controls }));
vi.mock("../src/pages/Karaoke/hooks/useMicrophoneSettings", () => ({
  default: () => mocks.microphone
}));
vi.mock("../src/pages/Karaoke/hooks/useAudioOutputRouting", () => ({ default: vi.fn() }));
vi.mock("../src/pages/Karaoke/hooks/useKaraokeMediaSync", () => ({
  default: (options) => {
    mocks.mediaSyncOptions = options;
    return { sendYouTubeCommand: vi.fn(), syncSecondaryMedia: vi.fn() };
  }
}));
vi.mock("../src/pages/Karaoke/hooks/usePitchDetection", () => ({
  default: () => ({
    sungMidi: 60,
    isPitchDetected: true,
    isPitchAttacking: false,
    pitchRestProgress: 0
  })
}));
vi.mock("../src/pages/Karaoke/hooks/useKaraokeTransport", () => ({
  default: (options) => {
    mocks.transportOptions = options;
    return mocks.transport;
  }
}));
vi.mock("../src/pages/Karaoke/hooks/useMelodyGuide", () => ({
  default: () => ({
    startMelodyGuide: vi.fn(),
    updateMelodyGuide: vi.fn(),
    silenceMelodyGuide: vi.fn()
  })
}));
vi.mock("../src/pages/Karaoke/hooks/useKaraokeHotkeys", () => ({ default: vi.fn() }));
vi.mock("../src/pages/Karaoke/hooks/useKaraokeStageLayout", () => ({ default: vi.fn() }));
import Karaoke from "../src/pages/Karaoke/index.jsx";
const song = {
  id: "song",
  title: "Song",
  artist: "Artist",
  status: "done",
  key_override: "C",
  note_range_min: 50,
  note_range_max: 75
};
const result = {
  song_map: {
    lines: [{ text: "Line", start: 0, end: 1 }],
    display_notes: [{ start: 0, end: 1, midi: 60 }]
  },
  music: { tempo: 120, key: "C" }
};
beforeEach(() => {
  Object.defineProperties(HTMLMediaElement.prototype, {
    load: { configurable: true, value: vi.fn() },
    readyState: { configurable: true, get: () => 0 }
  });
  mocks.location = { state: { songId: "song" } };
  mocks.navigate.mockReset();
  mocks.songsPoll = { data: [song], error: null };
  mocks.result = { result, loading: false, error: null };
  mocks.renderMedia = true;
  mocks.room.room = null;
  mocks.room.participants = [];
  mocks.room.syncUi.mockReset();
  mocks.radio.isPlaying = false;
  Object.values(mocks.radio).forEach((value) => value?.mockClear?.());
  mocks.preferences = {
    musicVolume: 0.7,
    setMusicVolume: vi.fn(),
    vocalVolume: 0.4,
    setVocalVolume: vi.fn(),
    melodyVolume: 0.8,
    setMelodyVolume: vi.fn(),
    speed: 1,
    setSpeed: vi.fn(),
    keyShift: 0,
    setKeyShift: vi.fn(),
    showLyrics: true,
    setShowLyrics: vi.fn((updater) => updater(true)),
    showNotes: true,
    setShowNotes: vi.fn((updater) => updater(true)),
    autoHideConsole: false,
    setAutoHideConsole: vi.fn(),
    effectPreset: "studio",
    setEffectPreset: vi.fn()
  };
  mocks.controls = {
    controlsVisible: true,
    hideControls: vi.fn(),
    revealControls: vi.fn(),
    showControls: vi.fn()
  };
  mocks.microphone = {
    microphoneVolume: 0.5,
    setMicrophoneVolume: vi.fn(),
    microphoneEffects: { reverb: 0, echo: 0, delay: 0 },
    setMicrophoneEffects: vi.fn((updater) => updater({ reverb: 0, echo: 0, delay: 0 })
    ),
    audioDriver: "wasapi",
    directOutputDeviceId: null,
    setDirectOutputDeviceId: vi.fn(),
    monitoringEnabled: false,
    setMonitoringEnabled: vi.fn(),
    monitorInputDeviceId: null,
    updateMicrophone: vi.fn()
  };
  mocks.transport = {
    returnToLibrary: vi.fn(),
    seekTo: vi.fn(),
    skip: vi.fn(),
    stop: vi.fn().mockResolvedValue(true),
    togglePlay: vi.fn().mockResolvedValue(true)
  };
  mocks.startMonitoring
    .mockReset()
    .mockResolvedValue({ monitoring_enabled: true });
  mocks.stopMonitoring
    .mockReset()
    .mockResolvedValue({ monitoring_enabled: false });
});
afterEach(() => { cleanup(); vi.useRealTimers(); });
describe("karaoke page", () => {
  test("renders ready song and wires stage, console, radio and monitoring", async () => {
    const appSettings = vi.fn();
    const page = render(<Karaoke onOpenAppSettings={appSettings} />);
    expect(page.getByTestId("stage")).not.toBeNull();
    same([mocks.stageProps.songId, "song"], [mocks.consoleProps.currentTempo, 120]);
    fireEvent.mouseMove(page.container.querySelector(".karaoke-stage"));
    fireEvent.click(page.getByTestId("preset"));
    verify([mocks.preferences.setEffectPreset, 'toHaveBeenCalledWith', "hall"], [mocks.microphone.updateMicrophone, 'toHaveBeenCalled']);
    fireEvent.click(page.getByTestId("monitor"));
    await waitFor(() => expect(mocks.startMonitoring).toHaveBeenCalled());
    expect(mocks.microphone.setMonitoringEnabled).toHaveBeenCalledWith(true);
    const radio = page.container.querySelector(".karaoke-stage-radio");
    fireEvent.click(radio);
    expect(mocks.radio.toggle).toHaveBeenCalled();
  });
  test("covers library, song, processing and result guard states", () => {
    const cases = [
      [ { data: null, error: new Error("offline") }, mocks.result, "field-error" ],
      [{ data: null, error: {} }, mocks.result, "field-error"],
      [{ data: null, error: null }, mocks.result, "text-muted"],
      [{ data: [], error: null }, mocks.result, "text-muted"],
      [ { data: [{ ...song, status: "processing" }], error: null }, mocks.result, "text-muted" ],
      [ { data: [song], error: null }, { result, loading: true, error: null }, "text-muted" ],
      [
        { data: [song], error: null },
        { result: null, loading: false, error: new Error("bad") },
        "field-error"
      ],
      [
        { data: [song], error: null },
        { result: null, loading: false, error: null },
        "field-error"
      ]
    ];
    for (const [poll, karaokeResult, className] of cases) {
      mocks.songsPoll = poll;
      mocks.result = karaokeResult;
      const view = render(<Karaoke />);
      expect(view.container.querySelector(`.${className}`)).not.toBeNull();
      cleanup();
    }
  });
  test("selects the first ready song when route state has no song id", () => {
    mocks.location = { state: null };
    mocks.songsPoll = {
      data: [{ ...song, id: "pending", status: "processing" }, song],
      error: null
    };
    render(<Karaoke />);
    expect(mocks.stageProps.songId).toBe("song");
  });
  test("renders the no-ready-song message without route state", () => {
    mocks.location = { state: null };
    mocks.songsPoll = { data: null, error: null };
    const loading = render(<Karaoke />);
    expect(loading.container.querySelector(".text-muted")).not.toBeNull();
    loading.unmount();
    mocks.songsPoll = { data: [], error: null };
    const empty = render(<Karaoke />);
    expect(empty.container.querySelector(".text-muted")).not.toBeNull();
  });
  test("starts playback with intro and stops through blackout transition", async () => {
    vi.useFakeTimers();
    const page = render(<Karaoke />);
    fireEvent.click(page.getByTestId("play"));
    fireEvent.mouseMove(page.container.querySelector(".karaoke-stage"));
    fireEvent.click(page.getByTestId("play"));
    await act(async () => Promise.resolve());
    page.container
      .querySelectorAll("audio")
      .forEach((audio) => fireEvent.canPlay(audio));
    await vi.runAllTimersAsync();
    expect(mocks.transport.togglePlay).toHaveBeenCalledWith({ forcePlaying: true });
    fireEvent.click(page.getByTestId("stop"));
    fireEvent.click(page.getByTestId("stop"));
    await vi.runAllTimersAsync();
    expect(mocks.transport.stop).toHaveBeenCalled();
    verify([mocks.navigate, 'toHaveBeenCalledWith', "/", expect.objectContaining({ replace: true })]);
  });
  test("syncs participant effects while a room is active", () => {
    mocks.room.room = { host: true };
    mocks.room.participants = [{ id: "guest" }];
    render(<Karaoke />);
    verify([mocks.room.syncUi, 'toHaveBeenCalledWith', { participantEffects: mocks.microphone.microphoneEffects }]);
  });
  test("suspends radio only for an active recording during playback", async () => {
    render(<Karaoke />);
    await act(async () => mocks.transportOptions.setRecordingSessionId("rec"));
    expect(mocks.radio.setRecordingActive).toHaveBeenLastCalledWith(false);
    await act(async () => mocks.transportOptions.setIsPlaying(true));
    expect(mocks.radio.setRecordingActive).toHaveBeenLastCalledWith(true);
    await act(async () => mocks.transportOptions.setRecordingSessionId(null));
    expect(mocks.radio.setRecordingActive).toHaveBeenLastCalledWith(false);
  });
  test("reports direct monitoring failure", async () => {
    mocks.startMonitoring.mockRejectedValueOnce(new Error("monitor failed"));
    const page = render(<Karaoke />);
    fireEvent.click(page.getByTestId("monitor"));
    await waitFor(() =>
      expect( page.container.querySelector(".karaoke-recording-error").textContent
      ).toContain("monitor failed")
    );
  });
  test("wires all console mutations and stopping monitoring", async () => {
    const page = render(<Karaoke />);
    fireEvent.click(page.getByTestId("effect"));
    fireEvent.click(page.getByTestId("commit"));
    fireEvent.click(page.getByTestId("tempo"));
    fireEvent.click(page.getByTestId("notes"));
    fireEvent.click(page.getByTestId("lyrics"));
    fireEvent.click(page.getByTestId("auto-hide"));
    fireEvent.click(page.getByTestId("seek"));
    fireEvent.click(page.getByTestId("skip"));
    fireEvent.click(page.getByTestId("monitor-off"));
    await waitFor(() => expect(mocks.stopMonitoring).toHaveBeenCalled());
    calledWith([mocks.preferences.setEffectPreset, ["custom"]], [mocks.microphone.updateMicrophone, [{ echo: 0.6 }]], [mocks.microphone.updateMicrophone, [{ volume: 0.9 }]], [mocks.preferences.setSpeed, [0.5]]);
    called(mocks.preferences.setShowNotes, mocks.preferences.setShowLyrics);
    calledWith([mocks.preferences.setAutoHideConsole, [true]], [mocks.transport.seekTo, [2]], [mocks.transport.skip, [5]], [mocks.microphone.setMonitoringEnabled, [false]]);
  });
  test("opens analysis result and handles every completion path", async () => {
    const page = render(<Karaoke />);
    await act(async () => mocks.transportOptions.setAnalysisRecordingId("rec"));
    expect(page.getByTestId("analysis-modal")).toBeTruthy();
    fireEvent.click(page.getByTestId("analysis-close"));
    verify([mocks.navigate, 'toHaveBeenCalledWith', "/", expect.objectContaining({ replace: true })]);
    await act(async () =>
      mocks.transportOptions.setAnalysisRecordingId( (previous) => previous || "next"
      )
    );
    fireEvent.click(page.getByTestId("analysis-done"));
    await act(async () => mocks.transportOptions.setAnalysisRecordingId("last")
    );
    fireEvent.click(page.getByTestId("analysis-delete"));
    expect(mocks.navigate).toHaveBeenCalledTimes(3);
  });
  test("pauses, resumes and restores radio after the first intro", async () => {
    vi.useFakeTimers();
    mocks.radio.isPlaying = true;
    const page = render(<Karaoke />);
    fireEvent.click(page.getByTestId("play"));
    await vi.runAllTimersAsync();
    await act(async () => mocks.transportOptions.setIsPlaying(true));
    mocks.radio.turnOn.mockRejectedValueOnce(new Error("radio unavailable"));
    fireEvent.click(page.getByTestId("play"));
    await act(async () => Promise.resolve());
    calledWith([mocks.transport.togglePlay, [{ forcePlaying: false }]], [mocks.radio.turnOn, [{ remember: false, fadeIn: true }]]);
    await act(async () => mocks.transportOptions.setIsPlaying(false));
    fireEvent.click(page.getByTestId("play"));
    verify([mocks.radio.turnOff, 'toHaveBeenCalled'], [mocks.transport.togglePlay, 'toHaveBeenCalledWith', { forcePlaying: true }]);
  });
  test("auto-starts after route handoff and clears its timers on unmount", async () => {
    vi.useFakeTimers();
    mocks.location = { state: { songId: "song", autoPlay: true } };
    const events = [];
    const listener = (event) => events.push(event.detail.visible);
    window.addEventListener("app:route-blackout", listener);
    const page = render(<Karaoke />);
    await vi.runAllTimersAsync();
    verify([mocks.transport.togglePlay, 'toHaveBeenCalledWith', { forcePlaying: true }], [events, 'toContain', false]);
    page.unmount();
    window.removeEventListener("app:route-blackout", listener);
  });
  test("releases blackout when auto-start media never mounts", async () => {
    vi.useFakeTimers();
    mocks.location = { state: { songId: "song", autoPlay: true } };
    mocks.renderMedia = false;
    const page = render(<Karaoke />);
    await vi.runAllTimersAsync();
    verify([mocks.transport.togglePlay, 'not.toHaveBeenCalled'], [mocks.stageProps.sceneBlackout, 'toBe', false]);
    page.unmount();
  });
  test("continues intro after media readiness timeout and handles media-ended callback", async () => {
    vi.useFakeTimers();
    const page = render(<Karaoke />);
    fireEvent.click(page.getByTestId("play"));
    await vi.runAllTimersAsync();
    expect(mocks.transport.togglePlay).toHaveBeenCalledWith({ forcePlaying: true });
    const ended = mocks.mediaSyncOptions.onPlaybackEndedRef.current();
    await vi.runAllTimersAsync();
    await ended;
    expect(mocks.transport.stop).toHaveBeenCalled();
  });
  test("starts immediately when song media is already ready", async () => {
    vi.useFakeTimers();
    Object.defineProperty(HTMLMediaElement.prototype, "readyState", {
      configurable: true,
      get: () => 4
    });
    const page = render(<Karaoke />);
    fireEvent.click(page.getByTestId("play"));
    await vi.runAllTimersAsync();
    expect(mocks.transport.togglePlay).toHaveBeenCalledWith({ forcePlaying: true });
  });
  test("handles declined playback, pause and stop transitions", async () => {
    vi.useFakeTimers();
    mocks.radio.isPlaying = true;
    mocks.transport.togglePlay.mockResolvedValue(false);
    mocks.transport.stop.mockResolvedValue(false);
    const page = render(<Karaoke />);
    fireEvent.click(page.getByTestId("play"));
    await vi.runAllTimersAsync();
    await act(async () => mocks.transportOptions.setIsPlaying(true));
    fireEvent.click(page.getByTestId("play"));
    await act(async () => Promise.resolve());
    fireEvent.click(page.getByTestId("stop"));
    await vi.runAllTimersAsync();
    expect(mocks.transport.stop).toHaveBeenCalled();
  });
  test("uses tempo, key and hidden-control fallbacks", () => {
    mocks.songsPoll = { data: [{ ...song, key_override: "", tempo_override: "bad" }], error: null };
    mocks.result = {
      result: { ...result, music: { tempo: "bad", key: "D" } },
      loading: false,
      error: null
    };
    mocks.controls.controlsVisible = false;
    const page = render(<Karaoke />);
    verify([mocks.consoleProps.currentTempo, 'toBe', 120], [mocks.consoleProps.compactKey, 'toContain', "D"]);
    // Stage actions render in a fixed order: back, console visibility
    // toggle, radio.
    const consoleToggle = page.container.querySelectorAll(".karaoke-stage-action")[1];
    fireEvent.click(consoleToggle);
    expect(mocks.controls.showControls).toHaveBeenCalled();
    page.unmount();
    mocks.result = {
      result: { ...result, music: { tempo: null, key: "" } },
      loading: false,
      error: null
    };
    render(<Karaoke />);
    expect(mocks.consoleProps.compactKey).toContain("C");
  });
  test("ignores an auto-start callback retained after unmount", () => {
    mocks.location = { state: { songId: "song", autoPlay: true } };
    let autoStart;
    const nativeSetTimeout = window.setTimeout;
    vi.spyOn(window, "setTimeout").mockImplementation(
      (callback, timeout, ...args) => {
        if (timeout === 80) autoStart = callback;
        return nativeSetTimeout(callback, timeout, ...args);
      }
    );
    const page = render(<Karaoke />);
    page.unmount();
    expect(() => autoStart()).not.toThrow();
  });
});
