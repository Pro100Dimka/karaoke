/* @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";
vi.mock("../src/i18n/runtime", () => ({
  translateSaved: (value, replacements = {}) =>
    Object.entries(replacements).reduce(
      (text, [key, replacement]) => text.replace(`{${key}}`, replacement),
      value
    )
}));
import KaraokeLoadState from "../src/pages/Karaoke/karaoke-load-state.jsx";
afterEach(cleanup);
const ready = {
  songs: [{ id: "song", title: "Song", status: "done" }],
  song: { id: "song", title: "Song", status: "done" },
  songId: "song",
  result: { lyrics: [] },
  resultLoading: false,
  resultError: null,
  songsError: null
};
test("renders nothing only when all karaoke prerequisites are ready", () => {
  const { container } = render(<KaraokeLoadState {...ready} />);
  expect(container.innerHTML).toBe("");
});
test("prioritizes library errors and distinguishes a missing selected song", () => {
  const { rerender } = render( <KaraokeLoadState {...ready} songsError={new Error("offline")} />
  );
  expect(screen.getByText(/offline/)).toBeTruthy();
  rerender(<KaraokeLoadState {...ready} song={null} />);
  expect(screen.getByText(/Выбранная песня не найдена/)).toBeTruthy();
});
test("covers processing, loading and missing-result edge states", () => {
  const { rerender } = render(
    <KaraokeLoadState
      {...ready}
      song={{ ...ready.song, status: "processing" }}
    />
  );
  expect(screen.getByText(/processing/)).toBeTruthy();
  rerender(<KaraokeLoadState {...ready} resultLoading />);
  expect(screen.getByText(/Загружаем данные караоке/)).toBeTruthy();
  rerender(<KaraokeLoadState {...ready} result={null} />);
  expect(screen.getByText(/результат обработки отсутствует/)).toBeTruthy();
});
