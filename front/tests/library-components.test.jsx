/* @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
import LibraryActions from "../src/pages/Library/components/hero/actions.jsx";
import LibraryHero from "../src/pages/Library/components/hero/hero.jsx";
import ProcessingSignal from "../src/pages/Library/components/song-card/processing-signal.jsx";
import SongCardArtwork from "../src/pages/Library/components/song-card/song-card-artwork.jsx";
import ProcessingModal from "../src/pages/Library/modals/processing.jsx";
import RecordingsModal from "../src/pages/Library/modals/recordings.jsx";
import { called, same, verify } from "./helpers/assertions.mjs";
import { passthrough } from "./helpers/mocks.mjs";

const mocks = vi.hoisted(() => ({ isPlaying: false, theme: "dark", noSettings: false }));
vi.mock("../src/contexts/radio", () => ({ useRadio: () => ({ isPlaying: mocks.isPlaying }) }));
vi.mock("../src/hooks/useAppSettings", () => ({
  default: () => (mocks.noSettings ? null : { settings: { theme: mocks.theme } })
}));
vi.mock("../src/theme/ui", () => ({
  Box: passthrough("div"),
  Stack: passthrough("div"),
  Typography: passthrough("span"),
  Badge: passthrough("span"),
  Card: ({ as: Comp = "div", children, cardPanel: _panel, cardContent: _content, ...props }) => (
    <Comp {...props}>{children}</Comp>
  ),
  Button: passthrough("button"),
  IconButton: passthrough("button")
}));
vi.mock("../src/components/ui", () => ({
  StatusBadge: ({ status }) => <span data-testid="status">{status}</span>
}));
vi.mock("../src/components/modal", () => ({
  default: ({ children, titleProps }) => (
    <section>
      <h1>{titleProps?.title}</h1>
      {titleProps?.actions}
      {children}
    </section>
  )
}));
vi.mock("../src/components/fields/button", () => ({
  default: ({ children, icon: _icon, iconProps: _iconProps, ...props }) => (
    <button {...props}>{children}</button>
  )
}));
vi.mock("../src/components/AudioPlayer", () => ({
  AudioPlayer: ({ src }) => <audio data-testid="player" src={src} />
}));
vi.mock("../src/api/client", () => ({
  api: {
    getPerformanceFileUrl: (id) => `recording/${id}`,
    getSongCoverUrl: (id) => `cover/${id}`
  }
}));
afterEach(() => {
  cleanup();
  mocks.noSettings = false;
});
test("library actions cover search, room, adding and file selection", () => {
  const setQuery = vi.fn();
  const onRoom = vi.fn();
  const onAdd = vi.fn();
  const onFile = vi.fn();
  const view = render(
    <LibraryActions
      canManageLibrary
      fileInputRef={createRef()}
      includeFileInput
      onFileChosen={onFile}
      onAdd={onAdd}
      onOpenRoom={onRoom}
      roomActive={false}
      query="q"
      setQuery={setQuery}
    />
  );
  const { container } = view;
  fireEvent.change(container.querySelector(".library-search-input"), { target: { value: "song" } });
  const buttons = container.querySelectorAll("button");
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);
  fireEvent.change(container.querySelector("input[type=file]"));
  expect(setQuery).toHaveBeenCalledWith("song");
  called(onRoom, onAdd, onFile);
  view.rerender(
    <LibraryActions
      canManageLibrary
      importing
      onAdd={onAdd}
      onOpenRoom={onRoom}
      query=""
      setQuery={setQuery}
    />
  );
});
test("hero and artwork reflect saved theme, counts and radio activity", () => {
  mocks.theme = "unknown";
  mocks.isPlaying = true;
  const { container, getByText } = render(
    <>
      <LibraryHero songCount={3} readyCount={2} />
      <SongCardArtwork cardIndex={2} />
    </>
  );
  verify([getByText("3"), "not.toBeNull"], [getByText("2"), "not.toBeNull"]);
  verify([
    container.querySelector(".library-song-card-art").classList.contains("is-radio-reactive"),
    "toBe",
    true
  ]);
  verify([container.querySelectorAll(".library-song-card-wave i"), "toHaveLength", 18]);
  mocks.noSettings = true;
  verify([() => render(<LibraryHero songCount={0} readyCount={0} />), "not.toThrow"]);
});
test("processing signal clamps progress and exposes an accessible value", () => {
  const { getByRole, rerender } = render(<ProcessingSignal progress={140} />);
  expect(getByRole("progressbar").getAttribute("aria-valuenow")).toBe("100");
  rerender(<ProcessingSignal progress="bad" compact />);
  expect(getByRole("progressbar").getAttribute("aria-valuenow")).toBe("0");
});
test("processing modal covers active, complete, error and absent songs", () => {
  const cancel = vi.fn();
  const close = vi.fn();
  const open = vi.fn();
  const active = render(
    <ProcessingModal
      song={{ id: "song", title: "Song", status: "processing" }}
      status={{ status: "processing", progress_percent: 20, eta_seconds: 5 }}
      onCancel={cancel}
      onClose={close}
      onOpenKaraoke={open}
    />
  );
  fireEvent.click(active.container.querySelector("button"));
  expect(cancel).toHaveBeenCalled();
  const art = active.container.querySelector(".processing-modal-art");
  expect(art.querySelector("img").src).toContain("cover/song");
  fireEvent.error(art.querySelector("img"));
  verify([art.querySelector("img"), "toBeNull"], [art.querySelector("svg"), "not.toBeNull"]);
  active.rerender(
    <ProcessingModal
      song={{ id: "song", title: "Song", status: "done" }}
      status={{ status: "done", error_message: "problem" }}
      onCancel={cancel}
      onClose={close}
      onOpenKaraoke={open}
    />
  );
  const buttons = active.container.querySelectorAll("button");
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);
  verify([close, "toHaveBeenCalled"], [open, "toHaveBeenCalledWith", "song"]);
  active.rerender(<ProcessingModal song={null} />);
  expect(active.container.firstChild).toBeNull();
  active.rerender(
    <ProcessingModal
      song={{ id: "song", status: "error" }}
      onCancel={cancel}
      onClose={close}
      onOpenKaraoke={open}
    />
  );
});
test("recordings modal renders empty, error and recording actions", () => {
  const analyze = vi.fn();
  const remove = vi.fn();
  const result = render(<RecordingsModal song={{ title: "Song" }} recordings={[]} />);
  verify([result.container.querySelector(".song-recordings-empty"), "not.toBeNull"]);
  result.rerender(<RecordingsModal song={{ title: "Song" }} error={new Error("offline")} />);
  verify([result.container.querySelector(".field-error").textContent, "toContain", "offline"]);
  result.rerender(
    <RecordingsModal
      song={{ title: "Song" }}
      recordings={[{ id: "rec", created_at: "2026-01-01", duration_sec: 3 }]}
      onAnalyze={analyze}
      onDelete={remove}
    />
  );
  const buttons = result.container.querySelectorAll("button");
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);
  same([analyze.mock.calls[0][0].id, "rec"], [remove.mock.calls[0][0].id, "rec"]);
  verify([result.getByTestId("player").getAttribute("src"), "toBe", "recording/rec"]);
  result.rerender(<RecordingsModal song={null} />);
  expect(result.container.firstChild).toBeNull();
});
