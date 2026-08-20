/* @vitest-environment jsdom */
import { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
import { verify } from "./helpers/assertions.mjs";
vi.mock("../src/components/fields", () => ({
  RangeInput: ({ onChange, ...props }) => (
    <input
      {...props}
      type="range"
      onChange={(event) => onChange?.(event.target.value)}
    />
  )
}));
vi.mock("../src/api/client", () => ({
  api: { getAudioTrackUrl: (id, track) => `${id}/${track}` }
}));
import KaraokeMedia from "../src/pages/Karaoke/components/karaoke-media.jsx";
import WaveformTimeline from "../src/pages/Karaoke/components/waveform-timeline.jsx";
import KaraokeLyrics from "../src/pages/Karaoke/components/karaoke-performance-stage/karaoke-lyrics.jsx";
const KaraokeLyricLine = ({ line, currentTime }) => (
  <KaraokeLyrics lyricsSync={{ text: line.text, words: line.words }} currentTime={currentTime} />
);
afterEach(cleanup);
test("karaoke media loads audio gain and initializes YouTube playback", () => {
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
  const audio = container.querySelector("audio");
  Object.defineProperty(audio, "volume", { configurable: true, writable: true, value: 0 });
  fireEvent.loadedMetadata(audio);
  expect(audio.volume).toBeGreaterThan(0);
  fireEvent.load(container.querySelector("iframe"));
  verify([send.mock.calls.map(([command]) => command), 'toEqual', [ "mute", "setPlaybackRate", "playVideo" ]]);
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
  verify([container.querySelector("video").getAttribute("src"), 'toBe', "video.mp4"]);
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
    container.querySelectorAll(".karaoke-lyric-character")[0].style.getPropertyValue(
      "--character-fill"
    )
  ).toBe("0%");
  rerender(
    <KaraokeLyricLine
      currentTime={3.9088815789473683}
      line={{ text: "Я", words: [{ text: "Я", start: 3.888836032388664, end: 3.9088815789473683 }] }}
    />
  );
  expect(
    container
      .querySelector(".karaoke-lyric-character")
      .style.getPropertyValue("--character-fill")
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
      container
        .querySelector(".karaoke-lyric-character")
        .style.getPropertyValue("--character-fill")
    )
  ).toBeCloseTo(50, 10);
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
