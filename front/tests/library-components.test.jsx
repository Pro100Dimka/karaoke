/* @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, expect, test, vi } from "vitest";
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
  Card: ({ as: Comp = "div", children, cardPanel: _panel, cardContent: _content, ...props }) => (
    <Comp {...props}>{children}</Comp>
  ),
  Button: passthrough("button"),
  IconButton: passthrough("button")
}));
vi.mock("../src/components/ui/StatusBadge", () => ({
  default: ({ status }) => <span data-testid="status">{status}</span>
}));
vi.mock("../src/components/modal", () => ({
  default: ({ children, titleProps }) => {
    const Icon = titleProps?.icon;
    return (
      <section>
        {titleProps?.image ? (
          <img
            className="modal-title__image"
            src={titleProps.image}
            alt=""
            onError={titleProps.onImageError}
          />
        ) : (
          Icon && <Icon />
        )}
        <h1>{titleProps?.title}</h1>
        <div className="modal-title__actions">{titleProps?.actions}</div>
        {children}
      </section>
    );
  }
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
import LibraryActions from "../src/pages/Library/components/hero/actions.jsx";
import LibraryHero from "../src/pages/Library/components/hero/hero.jsx";
import ProcessingSignal from "../src/pages/Library/components/song-card/processing-signal.jsx";
import SongCardArtwork from "../src/pages/Library/components/song-card/song-card-artwork.jsx";
import ProcessingModal, {
  getProcessingFailureInfo
} from "../src/pages/Library/modals/processing.jsx";
import RecordingsModal from "../src/pages/Library/modals/recordings.jsx";
import { getProcessingSongs } from "../src/pages/Library/utils.js";
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
test("processing songs keep the active job before the stable queue", () => {
  const queuedA = { id: "a", status: "queued" };
  const done = { id: "done", status: "done" };
  const active = { id: "active", status: "processing" };
  const queuedB = { id: "b", status: "queued" };
  expect(getProcessingSongs([queuedA, done, active, queuedB])).toEqual([
    active,
    queuedA,
    queuedB
  ]);
  const cancelling = { id: "cancel", status: "cancelling" };
  expect(getProcessingSongs([queuedA, cancelling, active])).toEqual([active, cancelling, queuedA]);
  expect(getProcessingSongs(null)).toEqual([]);
});
test("processing failure details classify backend causes without hiding the original reason", () => {
  expect(getProcessingFailureInfo("EngineUnavailableError: CTC model unavailable")).toMatchObject({
    type: "EngineUnavailableError",
    reason: "CTC model unavailable"
  });
  expect(getProcessingFailureInfo("InvalidArtifactError: invalid interval").hint).toContain(
    "интервалы"
  );
  expect(getProcessingFailureInfo("disk failure")).toMatchObject({
    type: "ProcessingError",
    reason: "disk failure"
  });
  expect(getProcessingFailureInfo("").reason).toContain("Причина");
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
  const cover = active.container.querySelector(".modal-title__image");
  expect(cover.src).toContain("cover/song");
  fireEvent.error(cover);
  verify(
    [active.container.querySelector(".modal-title__image"), "toBeNull"],
    [active.container.querySelector(".lucide-circle-dot"), "not.toBeNull"]
  );
  active.rerender(
    <ProcessingModal
      song={{ id: "song", title: "Song", status: "done" }}
      status={{ status: "done", error_message: "problem" }}
      onCancel={cancel}
      onClose={close}
      onOpenKaraoke={open}
    />
  );
  expect(active.container.querySelector(".modal-title__image").src).toContain("cover/song");
  const buttons = active.container.querySelectorAll("button");
  fireEvent.click(buttons[0]);
  fireEvent.click(buttons[1]);
  verify([close, "toHaveBeenCalled"], [open, "toHaveBeenCalledWith", "song"]);
  active.rerender(<ProcessingModal song={null} />);
  expect(active.container.firstChild).toBeNull();
  active.rerender(
    <ProcessingModal
      song={{
        id: "song",
        status: "error",
        progress_percent: 77,
        progress_step: "Синхронизация текста",
        error_message:
          "InvalidArtifactError: Full-song aligner returned invalid timestamps (word 0 has an invalid interval)"
      }}
      onCancel={cancel}
      onClose={close}
      onOpenKaraoke={open}
    />
  );
  const openApplicationLog = vi.fn();
  globalThis.electronAPI = { openApplicationLog };
  expect(active.queryByRole("progressbar")).toBeNull();
  expect(active.getByRole("alert").textContent).toContain("Full-song aligner");
  expect(active.getByRole("alert").textContent).toContain("InvalidArtifactError");
  expect(active.getByRole("alert").textContent).toContain("Синхронизация текста");
  expect(active.getByRole("alert").textContent).toContain("77%");
  fireEvent.click(active.getByRole("button", { name: "Открыть журнал выполнения" }));
  expect(openApplicationLog).toHaveBeenCalledOnce();
  delete globalThis.electronAPI;
});
test("processing modal carousel changes only the viewed queued song", () => {
  const select = vi.fn();
  const songs = [
    { id: "active", title: "Active", artist: "Artist A", status: "processing" },
    { id: "queued", title: "Queued", artist: "Artist B", status: "queued" }
  ];
  const view = render(
    <ProcessingModal
      song={songs[0]}
      songs={songs}
      status={{ song_id: "queued", status: "queued", progress_percent: 77 }}
      onSelectSong={select}
      onCancel={vi.fn()}
      onClose={vi.fn()}
      onOpenKaraoke={vi.fn()}
    />
  );
  expect(view.getByRole("heading").textContent).toBe("Active");
  expect(view.getByTestId("status").textContent).toBe("processing");
  const arrows = view.container.querySelectorAll(".processing-song-carousel button");
  expect(arrows).toHaveLength(2);
  expect(arrows[0].disabled).toBe(true);
  fireEvent.click(arrows[1]);
  expect(select).toHaveBeenCalledWith(songs[1]);
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
