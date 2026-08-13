/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";

const api = vi.hoisted(() => ({
  addSong: vi.fn(),
  processSong: vi.fn(),
  reprocessMelody: vi.fn(),
  deleteSong: vi.fn()
}));
const exclusive = vi.hoisted(() => ({ pending: false, run: vi.fn() }));
vi.mock("../src/api/client", () => ({ api }));
vi.mock("../src/hooks/useExclusiveAsyncAction", () => ({
  default: () => exclusive
}));

import useLibraryFileImport from "../src/pages/Library/hooks/use-file-import.js";
import useLibraryRoomSync from "../src/pages/Library/hooks/use-room-sync.js";
import useLibrarySongActions from "../src/pages/Library/hooks/use-song-actions.js";

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  exclusive.pending = false;
  exclusive.run.mockReset().mockImplementation((action) => action());
  delete window.electronAPI;
});
afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("library file import", () => {
  test("opens the picker and imports the selected file", async () => {
    const click = vi.fn();
    const notify = vi.fn();
    const onStarted = vi.fn();
    api.addSong.mockResolvedValue({ id: "song", title: "Track" });
    api.processSong.mockResolvedValue({});
    const { result } = renderHook(() =>
      useLibraryFileImport({
        fileInputRef: { current: { click } },
        notify,
        onStarted
      })
    );
    act(() => result.current.openFilePicker());
    expect(click).toHaveBeenCalledOnce();
    const input = { files: [new File(["audio"], "track.mp3")], value: "path" };
    await act(() => result.current.importFile({ currentTarget: input }));
    expect(input.value).toBe("");
    expect(api.addSong).toHaveBeenCalledWith(input.files[0], "track");
    expect(api.processSong).toHaveBeenCalledWith("song");
    expect(onStarted).toHaveBeenCalledWith(
      expect.objectContaining({ id: "song" })
    );
    expect(notify).not.toHaveBeenCalled();
  });

  test("ignores empty and concurrent selection and reports failures", async () => {
    const click = vi.fn();
    const notify = vi.fn().mockResolvedValue(undefined);
    exclusive.pending = true;
    const hook = renderHook(() =>
      useLibraryFileImport({
        fileInputRef: { current: { click } },
        notify,
        onStarted: vi.fn()
      })
    );
    act(() => hook.result.current.openFilePicker());
    expect(click).not.toHaveBeenCalled();
    await act(() =>
      hook.result.current.importFile({
        currentTarget: { files: [], value: "x" }
      })
    );
    expect(exclusive.run).not.toHaveBeenCalled();

    api.addSong.mockRejectedValue(new Error("invalid file"));
    await act(() =>
      hook.result.current.importFile({
        currentTarget: {
          files: [new File(["x"], "broken")],
          value: "x"
        }
      })
    );
    expect(notify).toHaveBeenCalledWith(
      expect.stringContaining("invalid file")
    );
  });
});

describe("library room synchronization", () => {
  test("broadcasts local query and host song changes", () => {
    const syncUi = vi.fn();
    const setQuery = vi.fn();
    const props = {
      localSongs: [{ id: 1 }],
      query: "local",
      room: { host: true },
      roomEventId: 1,
      roomQuery: undefined,
      participantCount: 1,
      setQuery,
      syncUi
    };
    const hook = renderHook((value) => useLibraryRoomSync(value), {
      initialProps: props
    });
    expect(syncUi).toHaveBeenCalledWith({ query: "local" });
    expect(syncUi).toHaveBeenCalledWith({ songs: [{ id: 1 }] });
    syncUi.mockClear();
    hook.rerender({
      ...props,
      localSongs: [{ id: 2 }],
      participantCount: 2
    });
    expect(syncUi).toHaveBeenCalledWith({ songs: [{ id: 2 }] });
    expect(setQuery).not.toHaveBeenCalled();
  });

  test("applies remote query once without echoing it", () => {
    const syncUi = vi.fn();
    const setQuery = vi.fn();
    const base = {
      localSongs: [],
      query: "local",
      room: { host: false },
      roomEventId: 1,
      roomQuery: "remote",
      participantCount: 1,
      setQuery,
      syncUi
    };
    const hook = renderHook((value) => useLibraryRoomSync(value), {
      initialProps: base
    });
    expect(setQuery).toHaveBeenCalledWith("remote");
    expect(syncUi).not.toHaveBeenCalled();
    hook.rerender({ ...base, query: "remote", roomEventId: 2 });
    expect(syncUi).toHaveBeenCalledWith({ query: "remote" });
    hook.rerender({ ...base, room: null, roomQuery: null });
  });
});

const actionProps = (overrides = {}) => ({
  confirmDialog: vi.fn().mockResolvedValue(true),
  notify: vi.fn().mockResolvedValue(undefined),
  onChanged: vi.fn().mockResolvedValue(undefined),
  processingSongId: "song",
  recordingsSongId: "song",
  setHiddenSongIds: vi.fn((update) => update(new Set())),
  setProcessingSong: vi.fn(),
  setRecordingsSong: vi.fn(),
  ...overrides
});

describe("library song actions", () => {
  test("processes pending songs and confirms reprocessing", async () => {
    const props = actionProps();
    api.processSong.mockResolvedValue({});
    api.reprocessMelody.mockResolvedValue({});
    const { result } = renderHook(() => useLibrarySongActions(props));
    const song = { id: "song", title: "Track", status: "pending" };
    await act(() => result.current.processSong(song));
    expect(props.confirmDialog).not.toHaveBeenCalled();
    expect(api.processSong).toHaveBeenCalledWith("song");
    expect(props.setProcessingSong).toHaveBeenCalledWith(song);

    await act(() => result.current.processSong({ ...song, status: "done" }));
    await act(() => result.current.reprocessSong(song));
    expect(props.confirmDialog).toHaveBeenCalledTimes(2);
    expect(api.reprocessMelody).toHaveBeenCalledWith("song");
    expect(props.onChanged).toHaveBeenCalledTimes(3);
  });

  test("supports cancellation, invalid songs and processing errors", async () => {
    const props = actionProps({
      confirmDialog: vi.fn().mockResolvedValue(false)
    });
    const hook = renderHook(() => useLibrarySongActions(props));
    await act(() =>
      hook.result.current.processSong({ id: "x", status: "done" })
    );
    await act(() => hook.result.current.reprocessSong({ id: "x" }));
    await act(() => hook.result.current.processSong(null));
    expect(api.processSong).not.toHaveBeenCalled();

    props.confirmDialog.mockResolvedValue(true);
    api.processSong.mockRejectedValue(new Error("pipeline busy"));
    await act(() =>
      hook.result.current.processSong({ id: "x", status: "pending" })
    );
    expect(props.notify).toHaveBeenCalledWith(
      expect.stringContaining("pipeline busy")
    );
  });

  test("deletes a song and closes matching library modals", async () => {
    const props = actionProps();
    api.deleteSong.mockResolvedValue({});
    const { result } = renderHook(() => useLibrarySongActions(props));
    await act(() => result.current.deleteSong({ id: "song", title: "Track" }));
    expect(api.deleteSong).toHaveBeenCalledWith("song");
    expect(props.setRecordingsSong).toHaveBeenCalledWith(null);
    expect(props.setProcessingSong).toHaveBeenCalledWith(null);
    expect(props.setHiddenSongIds).toHaveBeenCalled();
  });

  test("rolls back failed deletion and handles confirmation errors", async () => {
    const props = actionProps();
    api.deleteSong.mockRejectedValueOnce(new Error("locked"));
    const hook = renderHook(() => useLibrarySongActions(props));
    await act(() =>
      hook.result.current.deleteSong({ id: "x", title: "Track" })
    );
    expect(props.notify).toHaveBeenCalledWith(
      expect.stringContaining("locked")
    );

    props.confirmDialog.mockRejectedValueOnce(new Error("dialog failed"));
    await act(() =>
      hook.result.current.deleteSong({ id: "y", title: "Track" })
    );
    expect(props.notify).toHaveBeenCalledWith(
      expect.stringContaining("dialog failed")
    );
    props.confirmDialog.mockResolvedValueOnce(false);
    await act(() =>
      hook.result.current.deleteSong({ id: "z", title: "Track" })
    );
    await act(() => hook.result.current.deleteSong(null));
  });

  test("opens song folders through Electron and reports all fallback errors", async () => {
    const props = actionProps();
    const hook = renderHook(() => useLibrarySongActions(props));
    await act(() => hook.result.current.openSongFolder({ id: "song" }));
    expect(props.notify).toHaveBeenCalledOnce();

    const openSongFolder = vi
      .fn()
      .mockResolvedValueOnce("Windows error")
      .mockResolvedValueOnce("")
      .mockRejectedValueOnce(new Error("ipc failed"));
    window.electronAPI = { openSongFolder };
    const song = { output_dir: "path", slug: "slug", title: "Title", id: "id" };
    await act(() => hook.result.current.openSongFolder(song));
    await act(() => hook.result.current.openSongFolder(song));
    await act(() => hook.result.current.openSongFolder(song));
    expect(openSongFolder).toHaveBeenCalledWith({
      path: "path",
      slug: "slug",
      title: "Title",
      id: "id"
    });
    expect(props.notify).toHaveBeenCalledTimes(3);
  });
});
