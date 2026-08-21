/* @vitest-environment jsdom */
import { createRef } from "react";
import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, test, vi } from "vitest";
import { verify } from "./helpers/assertions.mjs";
const apiMocks = vi.hoisted(() => ({ getAudioTrackBlob: vi.fn() }));
vi.mock("../src/components/fields", () => ({
  RangeInput: ({ onChange, ...props }) => (
    <input {...props} type="range" onChange={(event) => onChange?.(event.target.value)} />
  )
}));
vi.mock("../src/api/client", () => ({
  api: {
    getAudioTrackUrl: (id, track) => `${id}/${track}`,
    getAudioTrackBlob: apiMocks.getAudioTrackBlob
  }
}));
import KaraokeMedia from "../src/pages/Karaoke/components/karaoke-media.jsx";
import WaveformTimeline from "../src/pages/Karaoke/components/waveform-timeline.jsx";
import KaraokeLyrics, {
  noteFillPercent
} from "../src/pages/Karaoke/components/karaoke-performance-stage/karaoke-lyrics.jsx";
const KaraokeLyricLine = ({ line, currentTime }) => (
  <KaraokeLyrics lyricsSync={{ text: line.text, words: line.words }} currentTime={currentTime} />
);
beforeEach(() => {
  apiMocks.getAudioTrackBlob.mockReset();
  apiMocks.getAudioTrackBlob.mockImplementation((_id, track) => Promise.resolve(new Blob([track])));
  delete globalThis.electronAPI;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
test("karaoke media keeps direct authenticated URLs inside Electron", () => {
  globalThis.electronAPI = { isElectron: true };
  const props = {
    instrumentalRef: createRef(),
    vocalsRef: createRef(),
    videoRef: createRef(),
    youTubeClipRef: createRef(),
    isPlaying: false,
    musicVolume: 0.5,
    vocalVolume: 0.4,
    speed: 1,
    youTubeVideoId: "",
    sendYouTubeCommand: vi.fn(),
    syncSecondaryMedia: vi.fn()
  };
  const { container, rerender } = render(
    <KaraokeMedia {...props} song={{ id: "electron-song", title: "Title" }} />
  );
  expect(
    [...container.querySelectorAll("audio")].map((audio) => audio.getAttribute("src"))
  ).toEqual(["electron-song/instrumental", "electron-song/vocals"]);
  rerender(<KaraokeMedia {...props} song={{ id: "next-song", title: "Next" }} />);
  expect(
    [...container.querySelectorAll("audio")].map((audio) => audio.getAttribute("src"))
  ).toEqual(["next-song/instrumental", "next-song/vocals"]);
  expect(apiMocks.getAudioTrackBlob).not.toHaveBeenCalled();
});
test("karaoke media releases authenticated files resolved after unmount", async () => {
  const resolvers = [];
  const release = vi.fn();
  const createObjectURL = vi.spyOn(URL, "createObjectURL");
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL");
  apiMocks.getAudioTrackBlob.mockImplementation(
    () => new Promise((resolve) => resolvers.push(resolve))
  );
  const view = render(
    <KaraokeMedia
      instrumentalRef={createRef()}
      vocalsRef={createRef()}
      videoRef={createRef()}
      youTubeClipRef={createRef()}
      isPlaying={false}
      musicVolume={0.5}
      vocalVolume={0.4}
      speed={1}
      song={{ id: "late-song", title: "Title" }}
      youTubeVideoId=""
      sendYouTubeCommand={vi.fn()}
      syncSecondaryMedia={vi.fn()}
    />
  );
  view.unmount();
  await act(async () => {
    resolvers.forEach((resolve) => {
      const file = new Blob(["audio"]);
      file.cleanup = release;
      resolve(file);
    });
    await Promise.resolve();
  });
  expect(createObjectURL).not.toHaveBeenCalled();
  expect(revokeObjectURL).not.toHaveBeenCalled();
  expect(release).toHaveBeenCalledTimes(2);
});
test("karaoke media leaves failed browser tracks unloaded", async () => {
  apiMocks.getAudioTrackBlob.mockRejectedValue(new Error("forbidden"));
  const { container } = render(
    <KaraokeMedia
      instrumentalRef={createRef()}
      vocalsRef={createRef()}
      videoRef={createRef()}
      youTubeClipRef={createRef()}
      isPlaying={false}
      musicVolume={0.5}
      vocalVolume={0.4}
      speed={1}
      song={{ id: "failed-song", title: "Title" }}
      youTubeVideoId=""
      sendYouTubeCommand={vi.fn()}
      syncSecondaryMedia={vi.fn()}
    />
  );
  await waitFor(() => expect(apiMocks.getAudioTrackBlob).toHaveBeenCalledTimes(2));
  expect(
    [...container.querySelectorAll("audio")].every((audio) => !audio.hasAttribute("src"))
  ).toBe(true);
});
test("karaoke media loads authenticated audio blobs and initializes YouTube playback", async () => {
  const createObjectURL = vi
    .spyOn(URL, "createObjectURL")
    .mockImplementation((blob) => `blob:${blob.size}`);
  const revokeObjectURL = vi.spyOn(URL, "revokeObjectURL").mockImplementation(() => {});
  const send = vi.fn();
  const sync = vi.fn();
  const instrumentalRef = createRef();
  const { container, rerender } = render(
    <KaraokeMedia
      instrumentalRef={instrumentalRef}
      vocalsRef={createRef()}
      videoRef={createRef()}
      youTubeClipRef={createRef()}
      isPlaying
      musicVolume={0.5}
      vocalVolume={0.4}
      speed={1.25}
      song={{ id: "song", title: "Title", video_url: "video.mp4" }}
      youTubeVideoId="video-id"
      sendYouTubeCommand={send}
      syncSecondaryMedia={sync}
    />
  );
  expect(
    [...container.querySelectorAll("audio")].every((audio) => !audio.hasAttribute("src"))
  ).toBe(true);
  await waitFor(() => expect(createObjectURL).toHaveBeenCalledTimes(2));
  send.mockClear();
  const audio = container.querySelector("audio");
  expect(audio.getAttribute("src")).toBe("blob:12");
  Object.defineProperty(audio, "volume", { configurable: true, writable: true, value: 0 });
  fireEvent.loadedMetadata(audio);
  expect(audio.volume).toBeGreaterThan(0);
  fireEvent.load(container.querySelector("iframe"));
  verify([
    send.mock.calls.map(([command]) => command),
    "toEqual",
    ["mute", "setPlaybackRate", "playVideo"]
  ]);
  expect(sync).toHaveBeenCalled();
  rerender(
    <KaraokeMedia
      instrumentalRef={instrumentalRef}
      vocalsRef={createRef()}
      videoRef={createRef()}
      youTubeClipRef={createRef()}
      isPlaying={false}
      musicVolume={0.5}
      vocalVolume={0.4}
      speed={1}
      song={{ id: "song", title: "Title" }}
      youTubeVideoId="video-id"
      sendYouTubeCommand={send}
      syncSecondaryMedia={sync}
    />
  );
  fireEvent.load(container.querySelector("iframe"));
  rerender(
    <KaraokeMedia
      instrumentalRef={instrumentalRef}
      vocalsRef={createRef()}
      videoRef={createRef()}
      youTubeClipRef={createRef()}
      isPlaying={false}
      musicVolume={0.5}
      vocalVolume={0.4}
      speed={1}
      song={{ id: "song", title: "Title", video_url: "video.mp4" }}
      youTubeVideoId=""
      sendYouTubeCommand={send}
      syncSecondaryMedia={sync}
    />
  );
  verify([container.querySelector("video").getAttribute("src"), "toBe", "video.mp4"]);
  cleanup();
  expect(revokeObjectURL).toHaveBeenCalledTimes(2);
});
test("waveform supports click, drag and range seeking", () => {
  const change = vi.fn();
  const { container, rerender } = render(
    <WaveformTimeline value={2} duration={10} onChange={change} />
  );
  const timeline = container.querySelector(".waveform-timeline");
  timeline.getBoundingClientRect = () => ({ left: 10, width: 100 });
  fireEvent.pointerDown(timeline, { clientX: 60 });
  fireEvent.pointerMove(timeline, { clientX: 80, buttons: 1 });
  fireEvent.pointerMove(timeline, { clientX: 90, buttons: 0 });
  fireEvent.change(container.querySelector("input"), { target: { value: "7" } });
  expect(change).toHaveBeenCalledTimes(3);
  rerender(<WaveformTimeline value={0} duration={0} onChange={change} />);
  fireEvent.pointerDown(container.querySelector(".waveform-timeline"), { clientX: 10 });
  expect(change).toHaveBeenCalledTimes(3);
  rerender(<WaveformTimeline value={0} duration={10} onChange={change} />);
  const zeroWidth = container.querySelector(".waveform-timeline");
  zeroWidth.getBoundingClientRect = () => ({ left: 0, width: 0 });
  fireEvent.pointerDown(zeroWidth, { clientX: 0 });
  expect(change).toHaveBeenCalledTimes(3);
});
test("lyrics highlight every word only between its exact lyricsSync start and end", () => {
  const { container, rerender } = render(
    <KaraokeLyricLine
      currentTime={3.888836032388664}
      className="line"
      line={{
        text: "Я не",
        words: [
          {
            index: 0,
            text: "Я",
            start: 3.888836032388664,
            end: 3.9088815789473683
          },
          {
            index: 1,
            text: "не",
            start: 4.069245951417004,
            end: 4.129382591093117,
            syllables: [{ text: "ignored", start: 0, end: 10 }]
          }
        ]
      }}
    />
  );
  expect(container.textContent).toBe("Яне");
  expect(container.querySelectorAll(".karaoke-lyric-syllable")).toHaveLength(0);
  expect(
    container
      .querySelectorAll(".karaoke-lyric-character")[0]
      .style.getPropertyValue("--character-fill")
  ).toBe("0%");
  rerender(
    <KaraokeLyricLine
      currentTime={3.9088815789473683}
      line={{
        text: "Я",
        words: [{ text: "Я", start: 3.888836032388664, end: 3.9088815789473683 }]
      }}
    />
  );
  expect(
    container.querySelector(".karaoke-lyric-character").style.getPropertyValue("--character-fill")
  ).toBe("100%");
  rerender(
    <KaraokeLyricLine
      currentTime={(4.790885627530364 + 4.83475) / 2}
      line={{
        text: "любви",
        words: [{ text: "любви", start: 4.790885627530364, end: 4.83475 }]
      }}
    />
  );
  expect(
    Number.parseFloat(
      container.querySelector(".karaoke-lyric-character").style.getPropertyValue("--character-fill")
    )
  ).toBeCloseTo(50, 10);
});

test("lyrics advance only while an acoustic note is sounding", () => {
  const word = {
    index: 0,
    text: "тяну",
    start: 0,
    end: 2,
    notes: [
      { note: 60, start: 0.2, end: 0.7 },
      { note: 62, start: 1.2, end: 1.7 }
    ]
  };
  const { container, rerender } = render(
    <KaraokeLyrics lyricsSync={{ text: "тяну", words: [word] }} currentTime={0.5} />
  );
  const fill = () =>
    Number.parseFloat(
      container.querySelector(".karaoke-lyric-character").style.getPropertyValue("--character-fill")
    );
  expect(fill()).toBeCloseTo(30, 10);
  rerender(<KaraokeLyrics lyricsSync={{ text: "тяну", words: [word] }} currentTime={0.9} />);
  expect(fill()).toBeCloseTo(50, 10);
  rerender(<KaraokeLyrics lyricsSync={{ text: "тяну", words: [word] }} currentTime={1.45} />);
  expect(fill()).toBeCloseTo(75, 10);
  rerender(<KaraokeLyrics lyricsSync={{ text: "тяну", words: [word] }} currentTime={1.7} />);
  expect(fill()).toBe(100);
});
test("note progress ignores invalid rows, clips intervals and preserves acoustic gaps", () => {
  const word = {
    start: 1,
    end: 4,
    notes: [
      { start: 3, end: 5 },
      { start: Number.NaN, end: 2 },
      { start: 0, end: 2 },
      { start: 2.5, end: 2.5 }
    ]
  };

  expect(noteFillPercent(word, 0)).toBe(0);
  expect(noteFillPercent(word, 1)).toBe(0);
  expect(noteFillPercent(word, 1.5)).toBe(25);
  expect(noteFillPercent(word, 2.5)).toBe(50);
  expect(noteFillPercent(word, 3.5)).toBe(75);
  expect(noteFillPercent(word, 5)).toBe(100);
  expect(noteFillPercent({ start: 2, end: 4 }, 3)).toBe(50);
  expect(noteFillPercent({ start: 2, end: 4, notes: "invalid" }, 1)).toBe(0);
  expect(noteFillPercent({ start: 2, end: 4, notes: [] }, 4)).toBe(100);
});

test("lyrics show only the current and next source lines", () => {
  const lyricsSync = {
    text: "Первая строка\n.\nВторая строка\nТретья строка",
    words: [
      { index: 0, text: "Первая", start: 1.01, end: 1.41 },
      { index: 1, text: "строка", start: 1.42, end: 1.82 },
      { index: 2, text: "Вторая", start: 2.01, end: 2.41 },
      { index: 3, text: "строка", start: 2.42, end: 2.82 },
      { index: 4, text: "Третья", start: 3.01, end: 3.41 },
      { index: 5, text: "строка", start: 3.42, end: 3.82 }
    ]
  };
  const { container, rerender } = render(
    <KaraokeLyrics lyricsSync={lyricsSync} currentTime={1.5} />
  );

  let lines = container.querySelectorAll(".karaoke-lyric");
  expect(lines).toHaveLength(2);
  expect(lines[0].textContent).toBe("Перваястрока");
  expect(lines[1].textContent).toBe("Втораястрока");
  expect(container.textContent).not.toContain("Третья");
  expect(lines[0].querySelector("[data-start]").dataset.start).toBe("1.01");
  expect(lines[0].querySelector("[data-end]").dataset.end).toBe("1.41");

  rerender(<KaraokeLyrics lyricsSync={lyricsSync} currentTime={2.5} />);
  lines = container.querySelectorAll(".karaoke-lyric");
  expect(lines).toHaveLength(2);
  expect(lines[0].textContent).toBe("Втораястрока");
  expect(lines[1].textContent).toBe("Третьястрока");
  expect(container.textContent).not.toContain("Первая");
});
