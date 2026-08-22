import assert from "node:assert/strict";
import { describe, test } from "vitest";
import { translateSaved as tr } from "../src/i18n/runtime.js";
import {
  arrangeSongs,
  countReadySongs,
  filterSongs,
  formatEta,
  formatLibraryDate,
  formatSongKey,
  getLibraryFilterOptions,
  getLocalVisibleSongs,
  getProcessingProgress,
  getProcessingSongs,
  getSongCardState,
  hasActiveSongProcessing,
  isProcessingActive,
  mergeSongProcessingStatus,
  resolveVisibleSongs
} from "../src/pages/Library/utils.js";

describe("library domain utilities", () => {
  test("formats dates and ETA at every boundary", () => {
    assert.equal(formatLibraryDate(null), "—");
    assert.equal(formatLibraryDate("invalid"), "—");
    assert.equal(formatLibraryDate("2026-08-21T00:00:00Z", "en-CA"), "2026-08-21");
    for (const value of [undefined, null, 0, -1, Number.NaN, Number.POSITIVE_INFINITY]) assert.equal(formatEta(value), tr("рассчитываем…"));
    assert.equal(formatEta(1.4), tr("~{0} сек", { 0: 1 }));
    assert.equal(formatEta(59.6), tr("~{0} мин {1} сек", { 0: 1, 1: 0 }));
    assert.equal(formatEta(125), tr("~{0} мин {1} сек", { 0: 2, 1: 5 }));
  });

  test("clamps progress and recognizes only active processing states", () => {
    assert.equal(getProcessingProgress({ progress_percent: 120 }, {}), 100);
    assert.equal(getProcessingProgress({ progress_percent: -3 }, {}), 0);
    assert.equal(getProcessingProgress({ progress_percent: "bad" }, { progress_percent: 80 }), 0);
    assert.equal(getProcessingProgress({}, { progress_percent: "42" }), 42);
    for (const status of ["processing", "queued", "cancelling"]) assert.equal(isProcessingActive(status), true);
    for (const status of ["done", "cancelled", "", null, undefined]) assert.equal(isProcessingActive(status), false);
    assert.equal(hasActiveSongProcessing([{ status: "done" }, { status: "queued" }]), true);
    assert.equal(hasActiveSongProcessing([{ status: "done" }, null]), false);
    assert.equal(hasActiveSongProcessing(null), false);
  });

  test("orders active processing songs without changing equal-status order", () => {
    const queuedA = { id: "qa", status: "queued" };
    const processing = { id: "p", status: "processing" };
    const done = { id: "d", status: "done" };
    const cancelling = { id: "c", status: "cancelling" };
    const queuedB = { id: "qb", status: "queued" };
    assert.deepEqual(getProcessingSongs([queuedA, done, queuedB, cancelling, processing, null]), [
      processing,
      cancelling,
      queuedA,
      queuedB
    ]);
    assert.deepEqual(getProcessingSongs(null), []);
  });

  test("merges only the matching processing status and preserves missing fields", () => {
    const first = { id: 1, status: "queued", progress_step: "old", progress_percent: 10 };
    const second = { id: 2, status: "done", error_message: "kept" };
    const unchanged = mergeSongProcessingStatus([first, second], {});
    assert.strictEqual(unchanged[0], first);
    assert.deepEqual(mergeSongProcessingStatus(undefined, { song_id: 1 }), []);
    const merged = mergeSongProcessingStatus([first, second], {
      song_id: "1",
      status: "processing",
      progress_step: null,
      progress_percent: 55,
      error_message: ""
    });
    assert.deepEqual(merged[0], {
      id: 1,
      status: "processing",
      progress_step: "old",
      progress_percent: 55,
      error_message: ""
    });
    assert.strictEqual(merged[1], second);
  });

  test("filters hidden, malformed and remote songs deterministically", () => {
    const local = [{ id: "local" }, null, "bad", { id: "hidden" }];
    assert.deepEqual(getLocalVisibleSongs(local, new Set(["hidden"])), [{ id: "local" }]);
    assert.deepEqual(getLocalVisibleSongs(null), []);
    assert.deepEqual(resolveVisibleSongs({ localSongs: local, room: null }), local);
    assert.deepEqual(resolveVisibleSongs({ localSongs: local, room: { host: true } }), local);
    const one = { id: "one", title: "first" };
    const duplicate = { id: "one", title: "duplicate" };
    const two = { id: "two" };
    assert.deepEqual(
      resolveVisibleSongs({
        localSongs: local,
        room: { host: false },
        roomSongs: [duplicate, two, null],
        roomSongsByParticipant: { a: [one], b: "bad" }
      }),
      [one, two]
    );
    const guest = { localSongs: local, room: { host: false }, roomSongs: [] };
    assert.deepEqual(resolveVisibleSongs(guest), local);
  });

  test("searches all metadata case-insensitively", () => {
    const songs = [{ title: "My Lady", artist: "Нервы", genre: "Rock" }, { title: "Весна", artist: null, genre: "Indie" }, null];
    assert.strictEqual(filterSongs(songs, ""), songs);
    assert.deepEqual(filterSongs(songs, "  НЕРВЫ "), [songs[0]]);
    assert.deepEqual(filterSongs(songs, "rock"), [songs[0]]);
    assert.deepEqual(filterSongs(songs, "весна indie"), [songs[1]]);
    assert.deepEqual(filterSongs(songs, "missing"), []);
    assert.deepEqual(filterSongs(null, "x"), []);
  });

  test("filters and sorts using only persisted song metadata", () => {
    const songs = [
      { title: "Beta", artist: "Zed", genre: "Rock", key: "Am", status: "done", created_at: "2026-01-01" },
      { title: "Alpha", artist: "Ann", genre: "Pop", key_override: "C", status: "processing", created_at: "2026-02-01" },
      { title: "Gamma", artist: "Bob", genre: "Rock", key: "C", status: "done", created_at: "2026-03-01" }
    ];
    assert.deepEqual(getLibraryFilterOptions(songs), { genres: ["Pop", "Rock"], keys: ["Am", "C"] });
    assert.deepEqual(
      arrangeSongs(songs, "", { sort: "title", genre: "Rock", key: "", status: "done" }).map(({ title }) => title),
      ["Beta", "Gamma"]
    );
    assert.deepEqual(
      arrangeSongs(songs, "", { sort: "recent", genre: "", key: "C", status: "" }).map(({ title }) => title),
      ["Gamma", "Alpha"]
    );
  });

  test("counts ready songs and derives safe card state", () => {
    assert.equal(countReadySongs([{ status: "done" }, { status: "pending" }, { status: "done" }]), 2);
    assert.equal(countReadySongs(null), 0);
    assert.deepEqual(getSongCardState({ status: "done" }), {
      status: "done",
      isWorking: false,
      isReady: true
    });
    assert.deepEqual(getSongCardState({ status: "queued" }), {
      status: "queued",
      isWorking: true,
      isReady: false
    });
    for (const song of [null, {}, { status: "" }, { status: 7 }])
      assert.deepEqual(getSongCardState(song), {
        status: "pending",
        isWorking: false,
        isReady: false
      });
  });

  test("normalizes conventional musical keys without corrupting longer names", () => {
    assert.equal(formatSongKey(" A   minor "), "Am");
    assert.equal(formatSongKey("C   MAJOR"), "Cmaj");
    assert.equal(formatSongKey("A minor extra"), "A minor extra");
    assert.equal(formatSongKey("C major extra"), "C major extra");
    for (const value of [null, undefined, "", "   "]) assert.equal(formatSongKey(value), tr("Тональность определяется"));
  });
});
