/* @vitest-environment jsdom */
import React, { createRef } from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

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
import SliderField from "../src/pages/Karaoke/components/slider-field.jsx";
import WaveformTimeline from "../src/pages/Karaoke/components/waveform-timeline.jsx";
import KaraokeLyricLine from "../src/pages/Karaoke/components/karaoke-performance-stage/karaoke-lyric-line.jsx";

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
  Object.defineProperty(audio, "volume", {
    configurable: true,
    writable: true,
    value: 0
  });
  fireEvent.loadedMetadata(audio);
  expect(audio.volume).toBeGreaterThan(0);
  fireEvent.load(container.querySelector("iframe"));
  expect(send.mock.calls.map(([command]) => command)).toEqual([
    "mute",
    "setPlaybackRate",
    "playVideo"
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
      song={{ id: "song", title: "Title", video_url: "video.mp4" }}
      youTubeVideoId=""
      sendYouTubeCommand={send}
      syncSecondaryMedia={sync}
    />
  );
  expect(container.querySelector("video").getAttribute("src")).toBe(
    "video.mp4"
  );
});

test("slider field binds its generated label and range", () => {
  const change = vi.fn();
  const { container, getByText } = render(
    <SliderField label="Volume" display="50%" value="0.5" onChange={change} />
  );
  fireEvent.change(container.querySelector("input"), {
    target: { value: "0.8" }
  });
  expect(change).toHaveBeenCalledWith("0.8");
  expect(getByText("50%")).not.toBeNull();
});

test("waveform supports click, drag and range seeking", () => {
  const change = vi.fn();
  const { container } = render(
    <WaveformTimeline value={2} duration={10} onChange={change} />
  );
  const timeline = container.querySelector(".waveform-timeline");
  timeline.getBoundingClientRect = () => ({ left: 10, width: 100 });
  fireEvent.pointerDown(timeline, { clientX: 60 });
  fireEvent.pointerMove(timeline, { clientX: 80, buttons: 1 });
  fireEvent.pointerMove(timeline, { clientX: 90, buttons: 0 });
  fireEvent.change(container.querySelector("input"), {
    target: { value: "7" }
  });
  expect(change).toHaveBeenCalledTimes(3);
});

test("lyrics render words, syllables, suffixes and untimed fallback text", () => {
  const { container, rerender } = render(
    <KaraokeLyricLine
      currentTime={0.5}
      className="line"
      line={{
        text: "Большой мир",
        words: [
          {
            text: "Большой",
            start: 0,
            end: 1,
            syllables: [
              { index: 0, text: "Бол", start: 0, end: 0.4 },
              { index: 1, text: "ьш", start: 0.4, end: 0.8 }
            ]
          },
          { text: "мир", start: 1, end: 2 }
        ]
      }}
    />
  );
  expect(container.textContent).toBe("Большоймир");
  expect(container.querySelectorAll(".karaoke-lyric-syllable")).toHaveLength(2);
  rerender(
    <KaraokeLyricLine
      currentTime={0}
      line={{ text: "Plain", start: 0, end: 1 }}
    />
  );
  expect(container.textContent).toBe("Plain");
});
