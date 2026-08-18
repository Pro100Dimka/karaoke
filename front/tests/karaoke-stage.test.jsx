/* @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { verify } from "./helpers/assertions.mjs";
const mocks = vi.hoisted(() => ({ panoramaRef: { current: null }, theme: { image: "scene.jpg" } }));
vi.mock("../src/pages/Karaoke/hooks/useKaraokePanorama", () => ({
  default: () => ({ activeTheme: mocks.theme, panoramaRef: mocks.panoramaRef })
}));
import KaraokePerformanceStage from "../src/pages/Karaoke/components/karaoke-performance-stage/index.jsx";
import MelodyRoll from "../src/pages/Karaoke/components/karaoke-performance-stage/melody-roll.jsx";
import AuroraWorld from "../src/pages/Karaoke/components/karaoke-performance-stage/aurora-world.jsx";
beforeEach(() => {
  delete globalThis.electronAPI;
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: { configurable: true, value: vi.fn().mockResolvedValue(undefined) }
  });
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); delete globalThis.electronAPI; });
const notes = [
  { start: 0, end: 1, midi: 60 },
  { start: 1, end: 2, midi: 61 },
  { start: 2, end: 3, midi: 72 },
  { start: 20, end: 21, midi: 80 }
];
test("melody roll renders keyboard, visible notes, current and sung pitch", () => {
  const { container, rerender } = render(
    <MelodyRoll
      notes={[...notes, { start: 0.2, end: 0.8, midi: 200 }]}
      currentTime={0.5}
      sungMidi={60.2}
      isPitchDetected
      keyShift={0}
      noteRangeMin={58}
      noteRangeMax={74}
    />
  );
  verify([container.querySelectorAll(".melody-note-past"), 'toHaveLength', 0], [container.querySelector(".melody-pitch-indicator"), 'not.toBeNull'], [container.querySelectorAll("svg rect").length, 'toBeGreaterThan', 2]);
  rerender(
    <MelodyRoll
      notes={notes}
      currentTime={1.5}
      sungMidi={61}
      isPitchDetected
      keyShift={0}
      noteRangeMin={58}
      noteRangeMax={74}
    />
  );
  verify([[...container.querySelectorAll("svg rect")].some( (node) => node.getAttribute("fill") === "#f3234c" ), 'toBe', true]);
  rerender(
    <MelodyRoll
      notes={notes}
      currentTime={2.5}
      sungMidi={200}
      isPitchDetected
      keyShift={2}
      noteRangeMin={58}
      noteRangeMax={74}
    />
  );
  verify([container.querySelectorAll(".melody-note-past").length, 'toBeGreaterThan', 0]);
  expect(container.querySelector(".melody-pitch-indicator")).toBeNull();
});
test("aurora world produces deterministic decoration, stars and particles", () => {
  const { container } = render(<AuroraWorld seed={12} />);
  verify([container.querySelectorAll(".aurora-stars i"), 'toHaveLength', 96], [container.querySelectorAll(".aurora-particles i"), 'toHaveLength', 112]);
  verify([container .querySelector(".aurora-stars i") .style.getPropertyValue("--aurora-x"), 'not.toBe', ""]);
});
test("stage displays panorama, intro, lyrics and melody", () => {
  const { container, rerender } = render(
    <KaraokePerformanceStage
      songId="song"
      isPlaying
      currentTime={0.5}
      lyrics={[{ text: "Line", start: 0, end: 1 }]}
      currentLine={{ text: "Line", start: 0, end: 1 }}
      upcomingLine={null}
      nextLine={{ text: "Next", start: 1, end: 2 }}
      notes={notes}
      showLyrics
      showNotes
      sceneBlackout
      sceneIntroVisible
      sceneIntro={{
        title: "Song",
        artist: "Artist",
        genre: "Pop",
        key: "C",
        tempo: 120,
        difficulty: "Easy"
      }}
    />
  );
  verify([container.querySelector(".karaoke-panoramic-sky"), 'not.toBeNull'], [container.querySelector(".melody-roll"), 'not.toBeNull'], [container.textContent, 'toContain', "LineNext"], [container.textContent, 'toContain', "Artist"]);
  rerender(
    <KaraokePerformanceStage
      songId=""
      isPlaying
      currentTime={0}
      lyrics={[{ text: "Soon", start: 1, end: 2 }]}
      currentLine={null}
      upcomingLine={{ text: "Soon", start: 1, end: 2 }}
      nextLine={null}
      notes={[]}
      showLyrics
      showNotes={false}
    />
  );
  expect(container.querySelector(".karaoke-lyric-upcoming")).not.toBeNull();
  rerender(
    <KaraokePerformanceStage
      songId="song"
      isPlaying={false}
      currentTime={5}
      lyrics={[{ text: "Line", start: 0, end: 1 }]}
      currentLine={null}
      upcomingLine={null}
      nextLine={null}
      notes={[]}
      showLyrics
      showNotes
      sceneBlackout={false}
      sceneIntroVisible={false}
    />
  );
  expect(container.textContent).toMatch(/завершена|завершена/i);
});
test("stage randomizes local scene video with a short fade", () => {
  vi.useFakeTimers();
  globalThis.electronAPI = { getSceneVideoUrl: () => "scene.mp4" };
  const result = render(
    <KaraokePerformanceStage
      songId="song"
      isPlaying
      currentTime={0}
      lyrics={[]}
      notes={[]}
      showLyrics
      showNotes={false}
      sceneBlackout={false}
      sceneIntroVisible={false}
    />
  );
  const video = result.container.querySelector("video");
  Object.defineProperty(video, "duration", { configurable: true, value: 10 });
  Object.defineProperty(video, "currentTime", { configurable: true, writable: true, value: 0 });
  fireEvent.loadedMetadata(video);
  expect(video.classList.contains("is-switching")).toBe(true);
  vi.advanceTimersByTime(180);
  verify([video.currentTime, 'toBeGreaterThan', 0], [HTMLMediaElement.prototype.play, 'toHaveBeenCalled']);
  vi.useRealTimers();
});
test("stage ignores a rejected background-video play request", async () => {
  vi.useFakeTimers();
  HTMLMediaElement.prototype.play.mockRejectedValueOnce(new Error("blocked"));
  globalThis.electronAPI = { getSceneVideoUrl: () => "scene.mp4" };
  const { container } = render(
    <KaraokePerformanceStage
      songId="song"
      isPlaying
      currentTime={0}
      lyrics={[]}
      notes={[]}
      showLyrics={false}
      showNotes={false}
    />
  );
  const video = container.querySelector("video");
  Object.defineProperty(video, "duration", { configurable: true, value: 0.5 });
  fireEvent.loadedMetadata(video);
  vi.advanceTimersByTime(180);
  await Promise.resolve();
  expect(HTMLMediaElement.prototype.play).toHaveBeenCalled();
  vi.useRealTimers();
});
test("ignores a delayed video switch after stage removal", () => {
  let delayed;
  const originalSetTimeout = window.setTimeout;
  vi.spyOn(window, "setTimeout").mockImplementation((callback, timeout) => {
    delayed = callback;
    return originalSetTimeout(callback, timeout);
  });
  globalThis.electronAPI = { getSceneVideoUrl: () => "scene.mp4" };
  const view = render(
    <KaraokePerformanceStage
      songId="song"
      isPlaying
      currentTime={0}
      lyrics={[]}
      notes={[]}
      showLyrics={false}
      showNotes={false}
    />
  );
  const video = view.container.querySelector("video");
  Object.defineProperty(video, "duration", { configurable: true, value: 2 });
  fireEvent.loadedMetadata(video);
  view.unmount();
  expect(() => delayed()).not.toThrow();
});
