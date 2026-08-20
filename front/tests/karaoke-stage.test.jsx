/* @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { verify } from "./helpers/assertions.mjs";
const mocks = vi.hoisted(() => ({ panoramaRef: { current: null }, theme: { image: "scene.jpg" } }));
vi.mock("../src/pages/Karaoke/hooks/useKaraokePanorama", () => ({
  default: () => ({ activeTheme: mocks.theme, panoramaRef: mocks.panoramaRef })
}));
import KaraokePerformanceStage from "../src/pages/Karaoke/components/karaoke-performance-stage/index.jsx";
import KaraokeLyrics from "../src/pages/Karaoke/components/karaoke-performance-stage/karaoke-lyrics.jsx";
import MelodyRoll from "../src/pages/Karaoke/components/karaoke-performance-stage/melody-roll.jsx";
import AuroraWorld from "../src/pages/Karaoke/components/karaoke-performance-stage/aurora-world.jsx";
beforeEach(() => {
  delete globalThis.electronAPI;
  vi.spyOn(Math, "random").mockReturnValue(0.5);
  Object.defineProperties(HTMLMediaElement.prototype, {
    play: { configurable: true, value: vi.fn().mockResolvedValue(undefined) }
  });
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  delete globalThis.electronAPI;
});
const notes = [
  { start: 0, end: 1, note: 60 },
  { start: 1, end: 2, note: 61 },
  { start: 2, end: 3, note: 72 },
  { start: 20, end: 21, note: 80 }
];
test("melody roll renders lyricsSync notes at exact boundaries", () => {
  const { container, rerender } = render(<MelodyRoll notes={notes} currentTime={0.5} />);
  expect(
    container.querySelectorAll(".melody-note, .melody-note-current, .melody-note-past")
  ).toHaveLength(3);
  expect(container.querySelector(".melody-note-current").dataset.midi).toBe("60");
  rerender(<MelodyRoll notes={notes} currentTime={1} />);
  expect(container.querySelector(".melody-note-current").dataset.midi).toBe("61");
});
test("melody roll uses only the moving lyricsSync note window and restores pitch feedback", () => {
  const { container } = render(
    <MelodyRoll notes={notes} currentTime={20.5} isPitchDetected sungMidi={80} />
  );
  const renderedNotes = container.querySelectorAll(
    ".melody-note, .melody-note-current, .melody-note-past"
  );
  expect(renderedNotes).toHaveLength(1);
  expect(renderedNotes[0].dataset.start).toBe("20");
  expect(renderedNotes[0].dataset.end).toBe("21");
  expect(container.querySelector(".melody-pitch-indicator")).not.toBeNull();
});
test("lyrics use the exact late-song start/end interval without accumulated drift", () => {
  const lyricsSync = {
    text: "застывал в ожидании тебя\nНеблагодарно\nС тобой",
    words: [
      { index: 0, text: "застывал", start: 27, end: 27.76 },
      { index: 1, text: "в", start: 27.84, end: 27.86 },
      { index: 2, text: "ожидании", start: 27.94, end: 28.7 },
      { index: 3, text: "тебя", start: 28.86, end: 29.16 },
      { index: 4, text: "Неблагодарно", start: 30.12, end: 31.38 },
      { index: 5, text: "С", start: 31.88, end: 31.9 },
      { index: 6, text: "тобой", start: 31.96, end: 32.78 }
    ]
  };
  const view = render(<KaraokeLyrics lyricsSync={lyricsSync} currentTime={30.75} />);
  const current = [...view.container.querySelectorAll(".karaoke-lyric-word")].find(
    (word) => word.textContent === "Неблагодарно"
  );
  expect(view.container.querySelectorAll(".karaoke-lyric")).toHaveLength(2);
  expect(current.dataset.start).toBe("30.12");
  expect(current.dataset.end).toBe("31.38");
  expect(current.style.getPropertyValue("--character-fill")).toBe("50%");
});
test("keeps a very short letter line visible without changing its word timing", () => {
  const lyricsSync = {
    text: "Длинная строка\nА я\nСледующая строка",
    words: [
      { index: 0, text: "Длинная", start: 17, end: 17.6 },
      { index: 1, text: "строка", start: 17.65, end: 18.2 },
      { index: 2, text: "А", start: 18.94, end: 18.96 },
      { index: 3, text: "я", start: 19.04, end: 19.06 },
      { index: 4, text: "Следующая", start: 19.2, end: 19.7 },
      { index: 5, text: "строка", start: 19.72, end: 20.1 }
    ]
  };

  const view = render(<KaraokeLyrics lyricsSync={lyricsSync} currentTime={19.25} />);

  expect(view.container.querySelector(".karaoke-lyric-current").textContent).toBe("Ая");
  const letter = [...view.container.querySelectorAll(".karaoke-lyric-word")].find(
    (word) => word.textContent === "А"
  );
  expect(letter.dataset.start).toBe("18.94");
  expect(letter.dataset.end).toBe("18.96");
  expect(letter.style.getPropertyValue("--character-fill")).toBe("100%");
});
test("aurora world produces deterministic decoration, stars and particles", () => {
  const { container } = render(<AuroraWorld seed={12} />);
  verify(
    [container.querySelectorAll(".aurora-stars i"), "toHaveLength", 96],
    [container.querySelectorAll(".aurora-particles i"), "toHaveLength", 112]
  );
  verify([
    container.querySelector(".aurora-stars i").style.getPropertyValue("--aurora-x"),
    "not.toBe",
    ""
  ]);
});
test("stage displays panorama, intro, lyrics and melody", () => {
  const { container, rerender } = render(
    <KaraokePerformanceStage
      songId="song"
      isPlaying
      currentTime={0.5}
      lyricsSync={{
        text: "Line\nNext",
        words: [
          { index: 0, text: "Line", start: 0, end: 1 },
          { index: 1, text: "Next", start: 1, end: 2 }
        ]
      }}
      currentLine={{ text: "Line", start: 0, end: 1, words: [{ text: "Line", start: 0, end: 1 }] }}
      upcomingLine={null}
      nextLine={{ text: "Next", start: 1, end: 2, words: [{ text: "Next", start: 1, end: 2 }] }}
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
  verify(
    [container.querySelector(".karaoke-panoramic-sky"), "not.toBeNull"],
    [container.querySelector(".melody-roll"), "not.toBeNull"],
    [container.textContent, "toContain", "LineNext"],
    [container.textContent, "toContain", "Artist"]
  );
  rerender(
    <KaraokePerformanceStage
      songId=""
      isPlaying
      currentTime={0}
      lyricsSync={{ text: "Soon", words: [{ index: 0, text: "Soon", start: 1, end: 2 }] }}
      currentLine={null}
      upcomingLine={{ text: "Soon", start: 1, end: 2, words: [{ text: "Soon", start: 1, end: 2 }] }}
      nextLine={null}
      notes={[]}
      showLyrics
      showNotes={false}
    />
  );
  expect(container.textContent).toContain("Soon");
  rerender(
    <KaraokePerformanceStage
      songId="song"
      isPlaying={false}
      currentTime={5}
      lyricsSync={{ text: "Line", words: [{ index: 0, text: "Line", start: 0, end: 1 }] }}
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
  expect(container.textContent).toContain("Line");
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
  verify(
    [video.currentTime, "toBeGreaterThan", 0],
    [HTMLMediaElement.prototype.play, "toHaveBeenCalled"]
  );
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
