/* @vitest-environment jsdom */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { translateSaved } from "../src/i18n/runtime.js";
import useLibraryFileImport from "../src/pages/Library/hooks/useFileImport.js";
import useLibraryRoomSync from "../src/pages/Library/hooks/useRoomSync.js";
import useLibrarySongActions from "../src/pages/Library/hooks/useSongActions.js";
import { notCalled, calledTimes, calledWith, verify } from "./helpers/assertions.mjs";

const api = vi.hoisted(() => ({
  addSong: vi.fn(),
  inspectSongIdentity: vi.fn(),
  processSong: vi.fn(),
  reprocessMelody: vi.fn(),
  deleteSong: vi.fn()
}));
const exclusive = vi.hoisted(() => ({ pending: false, run: vi.fn() }));
vi.mock("../src/api/client", () => ({ api }));
vi.mock("../src/hooks/useExclusiveAsyncAction", () => ({ default: () => exclusive }));
beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.inspectSongIdentity.mockResolvedValue({});
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
      useLibraryFileImport({ fileInputRef: { current: { click } }, notify, onStarted })
    );
    act(() => result.current.openFilePicker());
    expect(click).toHaveBeenCalledOnce();
    const input = { files: [new File(["audio"], "track.mp3")], value: "path" };
    await act(() => result.current.importFile({ currentTarget: input }));
    expect(input.value).toBe("");
    expect(result.current.review.items[0].title).toBe("track");
    expect(api.addSong).not.toHaveBeenCalled();
    await act(async () => {
      result.current.confirmDraft();
      await Promise.resolve();
    });
    calledWith(
      [api.addSong, [input.files[0], "track", ""]],
      [api.processSong, ["song", "auto"]],
      [onStarted, [expect.objectContaining({ id: "song" })]]
    );
    expect(notify).not.toHaveBeenCalled();
  });
  test("tracks changing picker state, callbacks and compound extensions", async () => {
    const click = vi.fn();
    const firstStarted = vi.fn();
    const secondStarted = vi.fn();
    const props = {
      fileInputRef: { current: { click } },
      notify: vi.fn(),
      onStarted: firstStarted
    };
    api.addSong.mockResolvedValue({ id: "song" });
    api.processSong.mockResolvedValue({});
    const hook = renderHook((value) => useLibraryFileImport(value), { initialProps: props });
    exclusive.pending = true;
    hook.rerender({ ...props, onStarted: secondStarted });
    act(() => hook.result.current.openFilePicker());
    expect(click).not.toHaveBeenCalled();
    exclusive.pending = false;
    hook.rerender({ ...props, onStarted: secondStarted });
    const file = new File(["audio"], "archive.tar.mp3");
    await act(() =>
      hook.result.current.importFile({ currentTarget: { files: [file], value: "path" } })
    );
    await act(async () => {
      hook.result.current.confirmDraft();
      await Promise.resolve();
    });
    verify(
      [api.addSong, "toHaveBeenCalledWith", file, "archive.tar", ""],
      [firstStarted, "not.toHaveBeenCalled"],
      [secondStarted, "toHaveBeenCalledWith", { id: "song" }],
      [api.processSong, "toHaveBeenCalledWith", "song", "auto"]
    );
  });
  test("prefills title and artist from the same backend metadata parser", async () => {
    const file = new File(["audio"], "wrong filename.mp3");
    api.inspectSongIdentity.mockResolvedValue({
      title: "Metadata title",
      artist: "Metadata artist",
      cover_data_url: "data:image/png;base64,cover"
    });
    const hook = renderHook(() =>
      useLibraryFileImport({ fileInputRef: { current: null }, notify: vi.fn(), onStarted: vi.fn() })
    );

    await act(() =>
      hook.result.current.importFile({ currentTarget: { files: [file], value: "path" } })
    );

    expect(api.inspectSongIdentity).toHaveBeenCalledWith(file);
    expect(hook.result.current.review.items[0]).toEqual(
      expect.objectContaining({
        title: "Metadata title",
        artist: "Metadata artist",
        coverUrl: "data:image/png;base64,cover"
      })
    );
    expect(api.addSong).not.toHaveBeenCalled();
  });
  test("ignores empty and concurrent selection and reports failures", async () => {
    const click = vi.fn();
    const notify = vi.fn().mockResolvedValue(undefined);
    exclusive.pending = true;
    const hook = renderHook(() =>
      useLibraryFileImport({ fileInputRef: { current: { click } }, notify, onStarted: vi.fn() })
    );
    act(() => hook.result.current.openFilePicker());
    expect(click).not.toHaveBeenCalled();
    await act(() => hook.result.current.importFile({ currentTarget: { files: [], value: "x" } }));
    expect(exclusive.run).not.toHaveBeenCalled();
    await act(() =>
      hook.result.current.importFile({ currentTarget: { files: undefined, value: "x" } })
    );
    expect(exclusive.run).not.toHaveBeenCalled();
    exclusive.pending = false;
    const missingPicker = renderHook(() =>
      useLibraryFileImport({ fileInputRef: { current: null }, notify, onStarted: vi.fn() })
    );
    expect(() => missingPicker.result.current.openFilePicker()).not.toThrow();
    api.addSong.mockRejectedValue(new Error("invalid file"));
    await act(() =>
      hook.result.current.importFile({
        currentTarget: { files: [new File(["x"], "broken")], value: "x" }
      })
    );
    await act(async () => {
      hook.result.current.confirmDraft();
      await Promise.resolve();
    });
    expect(notify).toHaveBeenCalledWith(expect.stringContaining("invalid file"));
  });
  test("rolls back a created song when processing cannot start", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    api.addSong.mockResolvedValue({ id: "rollback" });
    const processingError = new Error("pipeline busy");
    processingError.status = 409;
    api.processSong.mockRejectedValue(processingError);
    api.deleteSong.mockResolvedValue(null);
    const { result } = renderHook(() =>
      useLibraryFileImport({ fileInputRef: { current: null }, notify, onStarted: vi.fn() })
    );
    await act(() =>
      result.current.importFile({
        currentTarget: { files: [new File(["x"], "track.mp3")], value: "x" }
      })
    );
    await act(async () => {
      result.current.confirmDraft();
      await Promise.resolve();
    });
    calledWith(
      [api.deleteSong, ["rollback"]],
      [notify, [expect.stringContaining("pipeline busy")]]
    );
  });
  test("keeps a created song after an ambiguous process timeout", async () => {
    const notify = vi.fn().mockResolvedValue(undefined);
    const onStarted = vi.fn();
    api.addSong.mockResolvedValue({ id: "uncertain" });
    const timeout = new Error("deadline");
    timeout.name = "TimeoutError";
    api.processSong.mockRejectedValue(timeout);
    const { result } = renderHook(() =>
      useLibraryFileImport({ fileInputRef: { current: null }, notify, onStarted })
    );
    await act(() =>
      result.current.importFile({
        currentTarget: { files: [new File(["x"], "track.mp3")], value: "x" }
      })
    );
    await act(async () => {
      result.current.confirmDraft();
      await Promise.resolve();
    });
    expect(api.deleteSong).not.toHaveBeenCalled();
    calledWith([onStarted, [{ id: "uncertain" }]], [notify, [expect.stringContaining("deadline")]]);
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
    const hook = renderHook((value) => useLibraryRoomSync(value), { initialProps: props });
    calledWith([syncUi, [{ query: "local" }]], [syncUi, [{ songs: [{ id: 1 }] }]]);
    syncUi.mockClear();
    hook.rerender({ ...props, localSongs: [{ id: 2 }], participantCount: 2 });
    verify(
      [syncUi, "toHaveBeenCalledWith", { songs: [{ id: 2 }] }],
      [setQuery, "not.toHaveBeenCalled"]
    );
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
    const hook = renderHook((value) => useLibraryRoomSync(value), { initialProps: base });
    verify([setQuery, "toHaveBeenCalledWith", "remote"], [syncUi, "not.toHaveBeenCalled"]);
    hook.rerender({ ...base, query: "remote" });
    expect(syncUi).not.toHaveBeenCalled();
    setQuery.mockClear();
    hook.rerender({ ...base, query: "remote", roomQuery: "second-remote" });
    expect(setQuery).toHaveBeenCalledWith("second-remote");
    hook.rerender({ ...base, query: "second-remote", roomQuery: "second-remote" });
    syncUi.mockClear();
    hook.rerender({ ...base, query: "next-local", roomQuery: undefined });
    expect(syncUi).toHaveBeenCalledWith({ query: "next-local" });
    syncUi.mockClear();
    hook.rerender({ ...base, query: "offline", room: null, roomQuery: null });
    expect(syncUi).not.toHaveBeenCalled();
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
    calledWith([api.processSong, ["song"]], [props.setProcessingSong, [song]]);
    await act(() => result.current.processSong({ ...song, status: "done" }));
    await act(() => result.current.reprocessSong(song));
    expect(props.confirmDialog).toHaveBeenCalledTimes(2);
    verify([
      props.confirmDialog.mock.calls[0],
      "toEqual",
      [
        translateSaved(
          "Вы точно хотите обработать заново песню «{0}»? Ранее созданные результаты обработки будут обновлены.",
          { 0: "Track" }
        ),
        translateSaved("Обработать песню заново?")
      ]
    ]);
    verify([
      props.confirmDialog.mock.calls[1],
      "toEqual",
      [
        translateSaved(
          "Вы точно хотите обработать заново песню «{0}»? Текущие данные мелодии будут пересозданы.",
          { 0: "Track" }
        ),
        translateSaved("Обработать песню заново?")
      ]
    ]);
    verify(
      [api.reprocessMelody, "toHaveBeenCalledWith", "song"],
      [props.onChanged, "toHaveBeenCalledTimes", 3]
    );
  });
  test("supports cancellation, invalid songs and processing errors", async () => {
    const props = actionProps({ confirmDialog: vi.fn().mockResolvedValue(false) });
    const hook = renderHook(() => useLibrarySongActions(props));
    await act(() => hook.result.current.processSong({ id: "x", status: "done" }));
    await act(() => hook.result.current.reprocessSong({ id: "x" }));
    await act(() => hook.result.current.processSong(null));
    await act(() => hook.result.current.reprocessSong(null));
    notCalled(api.processSong, api.reprocessMelody);
    expect(props.confirmDialog).toHaveBeenCalledTimes(2);
    verify([
      props.confirmDialog,
      "toHaveBeenLastCalledWith",
      translateSaved(
        "Вы точно хотите обработать заново песню «{0}»? Текущие данные мелодии будут пересозданы.",
        { 0: translateSaved("Без названия") }
      ),
      translateSaved("Обработать песню заново?")
    ]);
    props.confirmDialog.mockResolvedValue(true);
    api.processSong.mockRejectedValue(new Error("pipeline busy"));
    await act(() => hook.result.current.processSong({ id: "x", status: "pending" }));
    expect(props.notify).toHaveBeenCalledWith(
      `${translateSaved("Не удалось запустить обработку")}: pipeline busy`
    );
    props.confirmDialog.mockResolvedValue(false);
    await act(() => hook.result.current.processSong({ id: "untitled", status: "done" }));
    verify([
      props.confirmDialog,
      "toHaveBeenLastCalledWith",
      translateSaved(
        "Вы точно хотите обработать заново песню «{0}»? Ранее созданные результаты обработки будут обновлены.",
        { 0: translateSaved("Без названия") }
      ),
      translateSaved("Обработать песню заново?")
    ]);
    props.confirmDialog.mockResolvedValue(true);
    api.reprocessMelody.mockRejectedValueOnce(new Error("midi busy"));
    await act(() => hook.result.current.reprocessSong({ id: "midi", title: "Midi" }));
    expect(props.notify).toHaveBeenLastCalledWith(
      `${translateSaved("Не удалось переобработать мелодию")}: midi busy`
    );
  });
  test("processing is exclusive, retryable and supports no change callback", async () => {
    let resolveProcessing;
    api.processSong.mockReturnValueOnce(
      new Promise((resolve) => {
        resolveProcessing = resolve;
      })
    );
    const props = actionProps({ onChanged: undefined });
    const hook = renderHook(() => useLibrarySongActions(props));
    const song = { id: "same", status: "pending" };
    let first;
    await act(async () => {
      first = hook.result.current.processSong(song);
      await hook.result.current.processSong(song);
    });
    expect(api.processSong).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveProcessing({});
      await first;
    });
    expect(props.notify).not.toHaveBeenCalled();
    api.processSong.mockResolvedValueOnce({});
    await act(() => hook.result.current.processSong(song));
    expect(api.processSong).toHaveBeenCalledTimes(2);
  });
  test("deletes a song and closes matching library modals", async () => {
    let hidden = new Set(["keep"]);
    const setHiddenSongIds = vi.fn((update) => {
      hidden = update(hidden);
    });
    const props = actionProps({ setHiddenSongIds });
    api.deleteSong.mockResolvedValue({});
    const { result } = renderHook(() => useLibrarySongActions(props));
    await act(() => result.current.deleteSong({ id: "song", title: "Track" }));
    calledWith(
      [api.deleteSong, ["song"]],
      [props.setRecordingsSong, [null]],
      [props.setProcessingSong, [null]]
    );
    expect(hidden).toEqual(new Set(["keep", "song"]));
    verify([
      props.confirmDialog,
      "toHaveBeenCalledWith",
      translateSaved("Удалить «{0}»? Это удалит все файлы песни.", { 0: "Track" }),
      translateSaved("Удалить песню?")
    ]);
    const unrelated = actionProps({ processingSongId: "other", recordingsSongId: "other" });
    const unrelatedHook = renderHook(() => useLibrarySongActions(unrelated));
    await act(() => unrelatedHook.result.current.deleteSong({ id: "second", title: "Second" }));
    notCalled(unrelated.setRecordingsSong, unrelated.setProcessingSong);
  });
  test("does not report successful backend mutations as failed when refresh breaks", async () => {
    let hidden = new Set();
    const props = actionProps({
      onChanged: vi.fn().mockRejectedValue(new Error("refresh failed")),
      setHiddenSongIds: vi.fn((update) => {
        hidden = update(hidden);
      })
    });
    api.deleteSong.mockResolvedValue({});
    api.processSong.mockResolvedValue({});
    const hook = renderHook(() => useLibrarySongActions(props));
    await act(() => hook.result.current.deleteSong({ id: "gone", title: "Gone" }));
    verify(
      [hidden.has("gone"), "toBe", true],
      [props.notify, "toHaveBeenCalledWith", expect.stringContaining("список")]
    );
    props.notify.mockClear();
    await act(() => hook.result.current.processSong({ id: "processing", status: "pending" }));
    calledWith(
      [props.setProcessingSong, [{ id: "processing", status: "pending" }]],
      [props.notify, [expect.stringContaining("список")]]
    );
  });
  test("keeps an ambiguously deleted song hidden until reconciliation succeeds", async () => {
    let hidden = new Set();
    const timeout = new Error("timeout");
    timeout.name = "TimeoutError";
    const props = actionProps({
      onChanged: vi.fn().mockRejectedValue(new Error("refresh failed")),
      setHiddenSongIds: vi.fn((update) => {
        hidden = update(hidden);
      })
    });
    api.deleteSong.mockRejectedValueOnce(timeout);
    const hook = renderHook(() => useLibrarySongActions(props));
    await act(() => hook.result.current.deleteSong({ id: "maybe-gone", title: "Track" }));
    expect(hidden.has("maybe-gone")).toBe(true);
    expect(props.onChanged).toHaveBeenCalledOnce();
    expect(props.notify).toHaveBeenCalledWith(expect.stringContaining("проверяем состояние"));
  });
  test("rolls back failed deletion and handles confirmation errors", async () => {
    let hidden = new Set(["keep"]);
    const props = actionProps({
      setHiddenSongIds: vi.fn((update) => {
        hidden = update(hidden);
      })
    });
    api.deleteSong.mockRejectedValueOnce(new Error("locked"));
    const hook = renderHook(() => useLibrarySongActions(props));
    await act(() => hook.result.current.deleteSong({ id: "x", title: "Track" }));
    expect(hidden).toEqual(new Set(["keep"]));
    verify([
      props.notify,
      "toHaveBeenCalledWith",
      translateSaved("Не удалось удалить: {0}", { 0: "locked" })
    ]);
    props.confirmDialog.mockRejectedValueOnce(new Error("dialog failed"));
    await act(() => hook.result.current.deleteSong({ id: "y", title: "Track" }));
    verify([
      props.notify,
      "toHaveBeenCalledWith",
      translateSaved("Не удалось подтвердить удаление: {0}", { 0: "dialog failed" })
    ]);
    props.confirmDialog.mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    await act(() => hook.result.current.deleteSong({ id: "z", title: "Track" }));
    await act(() => hook.result.current.deleteSong({ id: "z", title: "Track" }));
    calledTimes([props.confirmDialog, 4], [api.deleteSong, 1]);
    await act(() => hook.result.current.deleteSong(null));
  });
  test("actions use the latest callbacks after rerender", async () => {
    const firstNotify = vi.fn();
    const secondNotify = vi.fn().mockResolvedValue(undefined);
    const firstConfirm = vi.fn().mockResolvedValue(false);
    const secondConfirm = vi.fn().mockResolvedValue(true);
    const initial = actionProps({
      confirmDialog: firstConfirm,
      notify: firstNotify,
      onChanged: undefined
    });
    const hook = renderHook((value) => useLibrarySongActions(value), { initialProps: initial });
    const latest = { ...initial, confirmDialog: secondConfirm, notify: secondNotify };
    hook.rerender(latest);
    api.processSong.mockRejectedValueOnce(new Error("latest processing"));
    await act(() => hook.result.current.processSong({ id: "p", status: "pending" }));
    expect(firstNotify).not.toHaveBeenCalled();
    expect(secondNotify).toHaveBeenCalledWith(
      `${translateSaved("Не удалось запустить обработку")}: latest processing`
    );
    secondNotify.mockClear();
    api.reprocessMelody.mockRejectedValueOnce(new Error("latest midi"));
    await act(() => hook.result.current.reprocessSong({ id: "m", title: "Midi" }));
    expect(firstNotify).not.toHaveBeenCalled();
    expect(secondNotify).toHaveBeenCalledWith(
      `${translateSaved("Не удалось переобработать мелодию")}: latest midi`
    );
    secondNotify.mockClear();
    api.deleteSong.mockResolvedValueOnce({});
    await act(() => hook.result.current.deleteSong({ id: "d", title: "Delete" }));
    verify(
      [firstConfirm, "not.toHaveBeenCalled"],
      [secondConfirm, "toHaveBeenCalled"],
      [secondNotify, "not.toHaveBeenCalled"]
    );
    delete window.electronAPI;
    await act(() => hook.result.current.openSongFolder({ id: "d" }));
    verify([
      secondNotify,
      "toHaveBeenCalledWith",
      translateSaved("Открытие папки доступно только в установленном приложении.")
    ]);
  });
  test("opens song folders through Electron and reports all fallback errors", async () => {
    const props = actionProps();
    const hook = renderHook(() => useLibrarySongActions(props));
    await act(() => hook.result.current.openSongFolder({ id: "song" }));
    verify([
      props.notify,
      "toHaveBeenCalledWith",
      translateSaved("Открытие папки доступно только в установленном приложении.")
    ]);
    props.notify.mockClear();
    const openSongFolder = vi
      .fn()
      .mockResolvedValueOnce("Windows error")
      .mockResolvedValueOnce("")
      .mockRejectedValueOnce(new Error("ipc failed"));
    window.electronAPI = { openSongFolder };
    const song = { output_dir: "path", slug: "slug", title: "Title", id: "id" };
    await act(() => hook.result.current.openSongFolder(song));
    verify([
      props.notify,
      "toHaveBeenLastCalledWith",
      "Windows error",
      translateSaved("Не удалось открыть папку")
    ]);
    await act(() => hook.result.current.openSongFolder(song));
    expect(props.notify).toHaveBeenCalledTimes(1);
    await act(() => hook.result.current.openSongFolder(song));
    verify([
      props.notify,
      "toHaveBeenLastCalledWith",
      translateSaved("Не удалось открыть папку: {0}", { 0: "ipc failed" }),
      translateSaved("Не удалось открыть папку")
    ]);
    verify([
      openSongFolder,
      "toHaveBeenCalledWith",
      { path: "path", slug: "slug", title: "Title", id: "id" }
    ]);
    await act(() => hook.result.current.openSongFolder({}));
    expect(openSongFolder).toHaveBeenLastCalledWith({ path: "", slug: "", title: "", id: "" });
    expect(props.notify).toHaveBeenCalledTimes(2);
  });
});
