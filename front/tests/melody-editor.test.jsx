/* @vitest-environment jsdom */
import React from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  getSongEditor: vi.fn(),
  saveSongEditor: vi.fn(),
  resetSongEditor: vi.fn(),
  persist: vi.fn(),
  notify: vi.fn(),
  confirm: vi.fn()
}));

vi.mock("../src/api/client", () => ({
  api: {
    getSongEditor: mocks.getSongEditor,
    saveSongEditor: mocks.saveSongEditor,
    resetSongEditor: mocks.resetSongEditor,
    getAudioTrackUrl: (id, kind) => `${id}-${kind}`
  }
}));
vi.mock("../src/contexts/AppDialog", () => ({
  useAppDialog: () => ({ alert: mocks.notify, confirm: mocks.confirm })
}));
vi.mock("../src/utils/ui-preferences", () => ({
  persistUiPreferences: mocks.persist
}));
vi.mock("../src/components/ui", () => ({
  IconButton: ({ label, onClick, disabled, className }) => (
    <button
      type="button"
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      className={className}
    />
  )
}));
vi.mock("../src/pages/Karaoke/components/console/effect-dial", () => ({
  default: ({ label, value, onChange }) => (
    <input
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  )
}));
vi.mock("../src/pages/Karaoke/components/console/song-strip", () => ({
  default: ({ onSeek }) => (
    <button type="button" data-testid="song-strip" onClick={() => onSeek(1)} />
  )
}));

import MelodyEditor from "../src/pages/Library/modals/song-settings/melody-editor.jsx";

const payload = {
  ai_backup_exists: true,
  song_map: {
    duration: 4,
    syllables: [
      { index: 0, text: "Бо", word_index: 0 },
      { index: 1, text: "льшой", word_index: 0 }
    ],
    notes: [
      {
        _id: "one",
        start: 0,
        end: 1,
        midi_note: 60,
        velocity: 96,
        syllable_index: 0,
        word_index: 0
      },
      {
        _id: "two",
        start: 1,
        end: 2,
        midi_note: 62,
        velocity: 96,
        syllable_index: 1,
        word_index: 0
      }
    ]
  }
};

const audioParam = () => ({
  value: 0,
  setValueAtTime: vi.fn(),
  setTargetAtTime: vi.fn(),
  cancelScheduledValues: vi.fn(),
  exponentialRampToValueAtTime: vi.fn()
});
class FakeAudioContext {
  constructor() {
    this.currentTime = 0;
    this.destination = {};
  }
  resume = vi.fn();
  close = vi.fn();
  createGain = () => ({
    gain: audioParam(),
    connect() {
      return this;
    }
  });
  createBiquadFilter = () => ({
    type: "",
    frequency: audioParam(),
    Q: audioParam(),
    connect() {
      return this;
    }
  });
  createOscillator = () => ({
    type: "",
    frequency: audioParam(),
    connect() {
      return this;
    },
    start: vi.fn(),
    stop: vi.fn()
  });
}

beforeEach(() => {
  mocks.getSongEditor.mockReset().mockResolvedValue(payload);
  mocks.saveSongEditor.mockReset().mockResolvedValue(payload);
  mocks.resetSongEditor.mockReset().mockResolvedValue(payload);
  mocks.persist.mockReset();
  mocks.notify.mockReset().mockResolvedValue(undefined);
  mocks.confirm.mockReset().mockResolvedValue(true);
  globalThis.AudioContext = FakeAudioContext;
  globalThis.requestAnimationFrame = vi.fn(() => 1);
  globalThis.cancelAnimationFrame = vi.fn();
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: { configurable: true, value: vi.fn().mockResolvedValue(undefined) },
    pause: { configurable: true, value: vi.fn() }
  });
});

afterEach(() => {
  cleanup();
  delete globalThis.AudioContext;
});

const loadEditor = async (props = {}) => {
  const result = render(
    <MelodyEditor song={{ id: "song", title: "Song" }} {...props} />
  );
  await waitFor(() =>
    expect(
      result.container.querySelectorAll(".melody-editor-note")
    ).toHaveLength(2)
  );
  return result;
};

describe("melody editor", () => {
  test("loads, selects, merges, saves and restores notes", async () => {
    const onSaved = vi.fn();
    const { container } = await loadEditor({ onSaved });
    const notes = container.querySelectorAll(".melody-editor-note");
    fireEvent.pointerDown(notes[0], {
      pointerId: 1,
      clientX: 100,
      clientY: 100
    });
    fireEvent.pointerDown(notes[1], {
      pointerId: 2,
      clientX: 170,
      clientY: 80,
      shiftKey: true
    });
    const merge = container.querySelector(
      ".is-edit .melody-editor-tool.tone-amber"
    );
    expect(merge.disabled).toBe(false);
    fireEvent.click(merge);
    await waitFor(() =>
      expect(container.querySelectorAll(".melody-editor-note")).toHaveLength(1)
    );
    const save = container.querySelector(".melody-editor-tool.tone-pink");
    fireEvent.click(save);
    await waitFor(() => expect(mocks.saveSongEditor).toHaveBeenCalled());
    expect(onSaved).toHaveBeenCalled();
    const restore = container.querySelector(
      ".is-ai .melody-editor-tool.tone-amber"
    );
    fireEvent.click(restore);
    await waitFor(() => expect(mocks.resetSongEditor).toHaveBeenCalled());
  });

  test("handles transport, hotkeys, zoom, volume and close controls", async () => {
    const onClose = vi.fn();
    const { container, getByTestId } = await loadEditor({ onClose });
    fireEvent.click(getByTestId("song-strip"));
    const speed = container.querySelector("#melody-editor-playback-rate");
    fireEvent.change(speed, { target: { value: "0.75" } });
    fireEvent.change(
      container.querySelector("#melody-editor-horizontal-zoom"),
      {
        target: { value: "120" }
      }
    );
    fireEvent.change(container.querySelector("#melody-editor-vertical-zoom"), {
      target: { value: "20" }
    });
    fireEvent.change(
      container.querySelector(".melody-editor-compact-dials input"),
      {
        target: { value: "0.5" }
      }
    );
    fireEvent.keyDown(window, { code: "Space" });
    await waitFor(() =>
      expect(HTMLMediaElement.prototype.play).toHaveBeenCalled()
    );
    fireEvent.keyDown(window, { code: "Space" });
    fireEvent.keyDown(window, { code: "KeyS", ctrlKey: true });
    await waitFor(() => expect(mocks.saveSongEditor).toHaveBeenCalled());
    fireEvent.click(container.querySelector(".is-nav .melody-editor-tool"));
    expect(onClose).toHaveBeenCalled();
    expect(mocks.persist).toHaveBeenCalled();
  });

  test("reports load and save failures without leaving the editor busy", async () => {
    mocks.getSongEditor.mockRejectedValueOnce(new Error("load failed"));
    const empty = render(<MelodyEditor song={{ id: "song", title: "Song" }} />);
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled());
    expect(empty.container.querySelector(".melody-editor-loading")).toBeNull();
    cleanup();

    const { container } = await loadEditor();
    mocks.saveSongEditor.mockRejectedValueOnce(new Error("save failed"));
    fireEvent.click(container.querySelector(".melody-editor-tool.tone-pink"));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled());
    expect(
      container.querySelector(".melody-editor-tool.tone-pink").disabled
    ).toBe(false);
  });

  test("supports keyboard editing history, clipboard and note navigation", async () => {
    const { container } = await loadEditor();
    const key = (code, options = {}) =>
      fireEvent.keyDown(window, { code, key: options.key, ...options });
    fireEvent.pointerDown(container.querySelector(".melody-editor-note"), {
      pointerId: 1,
      clientX: 100,
      clientY: 100
    });

    key("KeyC", { ctrlKey: true });
    key("Home", { key: "Home" });
    key("KeyV", { ctrlKey: true });
    await waitFor(() =>
      expect(container.querySelectorAll(".melody-editor-note")).toHaveLength(3)
    );
    key("KeyZ", { ctrlKey: true });
    await waitFor(() =>
      expect(container.querySelectorAll(".melody-editor-note")).toHaveLength(2)
    );
    key("KeyZ", { ctrlKey: true, shiftKey: true });
    await waitFor(() =>
      expect(container.querySelectorAll(".melody-editor-note")).toHaveLength(3)
    );
    key("KeyY", { ctrlKey: true });
    key("KeyQ", { repeat: true });
    key("ArrowRight", { key: "ArrowRight" });
    key("ArrowLeft", { key: "ArrowLeft" });
    key("ArrowRight", { key: "ArrowRight", ctrlKey: true });
    key("ArrowLeft", { key: "ArrowLeft", ctrlKey: true, shiftKey: true });
    key("ArrowUp", { key: "ArrowUp" });
    key("ArrowDown", { key: "ArrowDown", shiftKey: true });
    key("Escape", { key: "Escape" });
    key("KeyA", { ctrlKey: true });
    key("Delete", { key: "Delete" });
    await waitFor(() =>
      expect(container.querySelectorAll(".melody-editor-note")).toHaveLength(0)
    );
    key("KeyZ", { ctrlKey: true });
    await waitFor(() =>
      expect(container.querySelectorAll(".melody-editor-note").length).toBeGreaterThan(
        0
      )
    );
    key("End", { key: "End" });
    const autoScroll = container.querySelector(".is-ai .tone-cyan");
    fireEvent.click(autoScroll);
    fireEvent.click(autoScroll);
  });

  test("does not trigger transport shortcuts from editable controls", async () => {
    const { container } = await loadEditor();
    const speed = container.querySelector("#melody-editor-playback-rate");
    fireEvent.keyDown(speed, { code: "Space" });
    expect(HTMLMediaElement.prototype.play).not.toHaveBeenCalled();

    const note = container.querySelector(".melody-editor-note");
    fireEvent.pointerDown(note, {
      pointerId: 1,
      clientX: 100,
      clientY: 100
    });
    fireEvent.change(
      container.querySelector(".melody-editor-inline-selection select"),
      { target: { value: "1" } }
    );
    expect(container.textContent).toContain("льшой");
  });

  test("handles note, marquee, playhead and custom scrollbar pointers", async () => {
    const { container } = await loadEditor();
    const shell = container.querySelector(".melody-editor-roll-shell");
    const canvas = container.querySelector(".melody-editor-roll-canvas");
    for (const [name, value] of Object.entries({
      clientWidth: 400,
      clientHeight: 300,
      scrollWidth: 1600,
      scrollHeight: 1000
    })) {
      Object.defineProperty(shell, name, { configurable: true, value });
    }
    canvas.getBoundingClientRect = () => ({ left: 0, top: 0 });
    fireEvent.scroll(shell);

    fireEvent.change(container.querySelector("#melody-editor-horizontal-zoom"), {
      target: { value: "180" }
    });
    fireEvent.change(container.querySelector("#melody-editor-horizontal-zoom"), {
      target: { value: "180" }
    });
    fireEvent.change(container.querySelector("#melody-editor-vertical-zoom"), {
      target: { value: "24" }
    });
    fireEvent.change(container.querySelector("#melody-editor-vertical-zoom"), {
      target: { value: "24" }
    });
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -1 });
    fireEvent.wheel(canvas, { ctrlKey: true, shiftKey: true, deltaY: 1 });
    fireEvent.change(container.querySelector("#melody-editor-horizontal-zoom"), {
      target: { value: "600" }
    });
    fireEvent.wheel(canvas, { ctrlKey: true, shiftKey: true, deltaY: -1 });
    fireEvent.change(container.querySelector("#melody-editor-vertical-zoom"), {
      target: { value: "36" }
    });
    fireEvent.wheel(canvas, { ctrlKey: true, deltaY: -1 });

    const tracks = container.querySelectorAll(".melody-editor-scroll-track");
    tracks[0].getBoundingClientRect = () => ({ left: 0, width: 100 });
    tracks[1].getBoundingClientRect = () => ({ top: 0, height: 100 });
    fireEvent.pointerDown(tracks[0], { clientX: 50 });
    fireEvent.pointerDown(tracks[1], { clientY: 50 });
    const thumbs = container.querySelectorAll(".melody-editor-scroll-thumb");
    fireEvent.pointerDown(thumbs[0], {
      pointerId: 1,
      clientX: 10,
      clientY: 10
    });
    fireEvent.pointerMove(thumbs[0], { pointerId: 1, clientX: 50, clientY: 10 });
    fireEvent.pointerUp(thumbs[0], { pointerId: 1 });
    fireEvent.pointerDown(thumbs[1], {
      pointerId: 2,
      clientX: 10,
      clientY: 10
    });
    fireEvent.pointerMove(thumbs[1], { pointerId: 2, clientX: 10, clientY: 50 });
    fireEvent.pointerCancel(thumbs[1], { pointerId: 2 });

    let note = container.querySelector(".melody-editor-note");
    fireEvent.pointerDown(note, {
      pointerId: 3,
      clientX: 100,
      clientY: 100
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 3,
      clientX: 130,
      clientY: 80
    });
    fireEvent.pointerUp(canvas, { pointerId: 3 });
    note = container.querySelector(".melody-editor-note");
    fireEvent.pointerDown(note.querySelector(".is-left"), {
      pointerId: 4,
      clientX: 100,
      clientY: 100
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 4,
      clientX: 90,
      clientY: 100
    });
    fireEvent.pointerUp(canvas, { pointerId: 4 });
    note = container.querySelector(".melody-editor-note");
    fireEvent.pointerDown(note.querySelector(".is-right"), {
      pointerId: 5,
      clientX: 100,
      clientY: 100
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 5,
      clientX: 110,
      clientY: 100
    });
    fireEvent.pointerCancel(canvas, { pointerId: 5 });

    fireEvent.pointerDown(canvas, {
      pointerId: 6,
      button: 0,
      clientX: 80,
      clientY: 450
    });
    fireEvent.pointerMove(canvas, {
      pointerId: 6,
      clientX: 220,
      clientY: 600
    });
    fireEvent.pointerUp(canvas, { pointerId: 6 });
    fireEvent.pointerDown(canvas, {
      pointerId: 9,
      button: 1,
      clientX: 10,
      clientY: 10
    });
    fireEvent.pointerDown(canvas, {
      pointerId: 10,
      button: 0,
      clientX: 10,
      clientY: 10
    });
    fireEvent.pointerUp(canvas, { pointerId: 10, clientX: 10, clientY: 10 });
    fireEvent.doubleClick(canvas, { clientX: 200 });
    fireEvent.pointerDown(container.querySelector(".melody-editor-piano-key"), {
      pointerId: 7
    });
    fireEvent.pointerDown(
      container.querySelector(".melody-editor-piano-key.is-black"),
      { pointerId: 11 }
    );

    const playhead = container.querySelector(".melody-editor-playhead");
    fireEvent.pointerMove(playhead, { pointerId: 8, clientX: 140 });
    fireEvent.pointerDown(playhead, { pointerId: 8, clientX: 140 });
    fireEvent.pointerMove(playhead, { pointerId: 8, clientX: 180 });
    fireEvent.pointerUp(playhead, { pointerId: 8, clientX: 180 });
    expect(shell.scrollLeft).toBeGreaterThanOrEqual(0);
  });

  test("honors cancelled AI restore and reports reset failures", async () => {
    mocks.confirm.mockResolvedValueOnce(false);
    let result = await loadEditor();
    fireEvent.click(result.container.querySelector(".is-ai .tone-amber"));
    expect(mocks.resetSongEditor).not.toHaveBeenCalled();
    cleanup();

    mocks.confirm.mockResolvedValueOnce(true);
    mocks.resetSongEditor.mockRejectedValueOnce(new Error("reset failed"));
    result = await loadEditor();
    fireEvent.click(result.container.querySelector(".is-ai .tone-amber"));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled());
  });

  test("synchronizes running media, melody synth and media events", async () => {
    const frames = [];
    globalThis.requestAnimationFrame = vi.fn((callback) => {
      frames.push(callback);
      return frames.length;
    });
    const { container } = await loadEditor();
    const [vocals, master] = container.querySelectorAll("audio");
    const shell = container.querySelector(".melody-editor-roll-shell");
    for (const [name, value] of Object.entries({
      clientWidth: 300,
      scrollWidth: 1600
    })) {
      Object.defineProperty(shell, name, { configurable: true, value });
    }
    Object.defineProperties(master, {
      paused: { configurable: true, value: false },
      ended: { configurable: true, value: false },
      currentTime: { configurable: true, writable: true, value: 0.5 },
      playbackRate: { configurable: true, writable: true, value: 1 }
    });
    Object.defineProperties(vocals, {
      currentTime: { configurable: true, writable: true, value: 1 },
      playbackRate: { configurable: true, writable: true, value: 1 }
    });

    await act(async () => frames.at(-1)(500));
    fireEvent.change(
      container.querySelectorAll(".melody-editor-compact-dials input")[1],
      { target: { value: "0.2" } }
    );
    vocals.currentTime = 0.55;
    await act(async () => frames.at(-1)(1000));
    vocals.currentTime = master.currentTime;
    vocals.playbackRate = 0.8;
    await act(async () => frames.at(-1)(1500));
    master.currentTime = 3.5;
    await act(async () => frames.at(-1)(2000));

    fireEvent.timeUpdate(master);
    const playhead = container.querySelector(".melody-editor-playhead");
    fireEvent.pointerDown(playhead, { pointerId: 3, clientX: 150 });
    fireEvent.pointerUp(playhead, { pointerId: 3, clientX: 150 });
    Object.defineProperty(master, "paused", { configurable: true, value: true });
    await act(async () => frames.at(-1)(2500));
    fireEvent.timeUpdate(master);
    fireEvent.pause(master);
    fireEvent.ended(master);
    expect(globalThis.AudioContext).toBe(FakeAudioContext);
  });

  test("covers duplicate, cut, mixer controls and playback failure recovery", async () => {
    const { container } = await loadEditor();
    fireEvent.pointerDown(container.querySelector(".melody-editor-note"), {
      pointerId: 1,
      clientX: 100,
      clientY: 100
    });
    fireEvent.keyDown(window, { code: "KeyD", ctrlKey: true });
    await waitFor(() =>
      expect(container.querySelectorAll(".melody-editor-note")).toHaveLength(3)
    );
    fireEvent.keyDown(window, { code: "KeyX", ctrlKey: true });
    await waitFor(() =>
      expect(container.querySelectorAll(".melody-editor-note")).toHaveLength(2)
    );
    const dials = container.querySelectorAll(".melody-editor-compact-dials input");
    fireEvent.change(dials[1], { target: { value: "0.4" } });
    fireEvent.change(dials[2], { target: { value: "0.3" } });

    const master = container.querySelectorAll("audio")[1];
    Object.defineProperty(master, "play", {
      configurable: true,
      value: () => {
        throw new Error("play failed");
      }
    });
    fireEvent.click(container.querySelector(".is-transport .melody-editor-tool"));
    await waitFor(() => expect(mocks.notify).toHaveBeenCalled());
  });

  test("derives duration when SongMap does not provide it", async () => {
    mocks.getSongEditor.mockResolvedValueOnce({
      ...payload,
      song_map: { ...payload.song_map, duration: 0 }
    });
    const { container } = await loadEditor();
    expect(container.querySelector(".melody-editor-timecode").textContent).toContain(
      "2.00"
    );
  });
});
