/* @vitest-environment jsdom */
import React from "react";
import { cleanup, fireEvent, render } from "@testing-library/react";
import { afterEach, expect, test, vi } from "vitest";

vi.mock("../src/theme/ui", () => ({
  Badge: ({ children, ...props }) => <span {...props}>{children}</span>,
  Button: ({ children, ...props }) => <button {...props}>{children}</button>,
  Card: ({ children, ...props }) => <div {...props}>{children}</div>,
  IconButton: ({ children, ...props }) => (
    <button {...props}>{children}</button>
  ),
  Stack: ({ children, ...props }) => <div {...props}>{children}</div>,
  Typography: ({ children, ...props }) => <span {...props}>{children}</span>
}));
vi.mock("../src/pages/Library/components/song-card/processing-signal", () => ({
  default: ({ progress }) => <span data-testid="progress">{progress}</span>
}));
vi.mock("../src/pages/Library/components/song-card/song-card-artwork", () => ({
  default: ({ cardIndex }) => <span data-testid="artwork">{cardIndex}</span>
}));

import LibrarySongCard from "../src/pages/Library/components/song-card/index.jsx";

afterEach(cleanup);

const handlers = () => ({
  onDelete: vi.fn(),
  onOpenFolder: vi.fn(),
  onOpenKaraoke: vi.fn(),
  onOpenProcessing: vi.fn(),
  onOpenRecordings: vi.fn(),
  onOpenSettings: vi.fn(),
  onProcess: vi.fn(),
  onReprocess: vi.fn()
});

test("ready song opens from card click and keyboard but not nested actions", () => {
  const actions = handlers();
  const song = {
    id: "song",
    title: "Title",
    artist: "Artist",
    status: "done",
    key_override: "C",
    tempo_override: 120,
    difficulty_override: "easy"
  };
  const { container } = render(
    <LibrarySongCard cardIndex={1} song={song} canManageLibrary {...actions} />
  );
  const card = container.querySelector(".library-song-card");
  expect(card.getAttribute("role")).toBe("button");
  fireEvent.click(card);
  fireEvent.keyDown(card, { key: "Enter" });
  fireEvent.keyDown(card, { key: " " });
  fireEvent.keyDown(card, { key: "Escape" });
  expect(actions.onOpenKaraoke).toHaveBeenCalledTimes(3);
  const nested = container.querySelector(".library-song-card-actions button");
  fireEvent.click(nested);
  expect(actions.onOpenKaraoke).toHaveBeenCalledTimes(3);
  expect(container.textContent).toContain("120 BPM");
});

test("working song shows progress and opens its processing modal", () => {
  const actions = handlers();
  const song = {
    id: "song",
    title: "Title",
    status: "processing",
    progress_percent: 42
  };
  const { container, getByTestId } = render(
    <LibrarySongCard cardIndex={0} song={song} canManageLibrary {...actions} />
  );
  expect(getByTestId("progress").textContent).toBe("42");
  fireEvent.click(container.querySelector(".library-song-card-progress"));
  expect(actions.onOpenProcessing).toHaveBeenCalledWith(song);
  expect(
    container.querySelector(".library-song-card").getAttribute("role")
  ).toBeNull();
});

test("unknown song status uses safe badge fallback", () => {
  const actions = handlers();
  const { container } = render(
    <LibrarySongCard
      cardIndex={0}
      song={{ id: "song", title: "Title", status: "custom" }}
      {...actions}
    />
  );
  expect(container.querySelector(".badge").textContent).toContain("custom");
});
