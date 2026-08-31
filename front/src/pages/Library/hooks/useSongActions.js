import { useCallback, useRef } from "react";
import { api } from "../../../api/client";
import { isAmbiguousTransportError } from "../../../api/core";
import { translateSaved as tr } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";
import * as platform from "../../../utils/platform";

const removeFromSet = (setter, id) =>
  setter((ids) => {
    const next = new Set(ids);
    next.delete(id);
    return next;
  });

const mediaUrl = (media) => String(media?.currentSrc || media?.src || "");

export async function releaseSongMedia(songId, root = globalThis.document) {
  if (!songId || !root?.querySelectorAll) return;
  const marker = `/songs/${encodeURIComponent(String(songId))}/`;
  const mediaElements = [...root.querySelectorAll("audio, video")].filter((media) => {
    const urls = [
      mediaUrl(media),
      ...[...(media.querySelectorAll?.("source") || [])].map(mediaUrl)
    ];
    return urls.some((url) => url.includes(marker));
  });
  if (!mediaElements.length) return;
  for (const media of mediaElements) {
    try {
      media.pause?.();
      media.removeAttribute?.("src");
      media.querySelectorAll?.("source").forEach((source) => source.removeAttribute("src"));
      media.load?.();
    } catch {
      // A detached/partially initialized media element may reject load().
      // Continue releasing every other reference to the same song.
    }
  }
  // Chromium's network service releases the Windows file handle
  // asynchronously after load() detaches the source.
  await new Promise((resolve) => globalThis.setTimeout(resolve, 100));
}

export default function useLibrarySongActions({
  confirmDialog,
  notify,
  onChanged,
  processingSongId,
  recordingsSongId,
  setHiddenSongIds,
  setProcessingSong,
  setRecordingsSong
}) {
  const busy = useRef({ delete: new Set(), process: new Set() });
  const process = useCallback(
    async (song, request, message) => {
      if (!song?.id || busy.current.process.has(song.id)) return;
      busy.current.process.add(song.id);
      try {
        try {
          await request(song.id);
        } catch (error) {
          await notify(
            isAmbiguousTransportError(error)
              ? tr("library.backendDidNotConfirmTheOperationResult", { 0: getErrorMessage(error) })
              : `${message}: ${getErrorMessage(error)}`
          );
          if (!isAmbiguousTransportError(error)) return;
        }
        setProcessingSong(song);
        try {
          await onChanged?.();
        } catch (error) {
          await notify(
            tr("library.operationCompletedButTheListDidNotRefresh", {
              0: getErrorMessage(error)
            })
          );
        }
      } finally {
        busy.current.process.delete(song.id);
      }
    },
    [notify, onChanged, setProcessingSong]
  );

  const confirmReprocess = useCallback(
    (text) => confirmDialog(text, tr("library.reworkTheSong")),
    [confirmDialog]
  );

  const processSong = useCallback(
    async (song) => {
      if (!song?.id) return;
      if (
        song?.status !== "pending" &&
        !(await confirmReprocess(
          tr("library.areYouSureYouWantToReArrangeThe", { 0: song?.title || tr("api.untitled") })
        ))
      )
        return;
      await process(song, api.processSong, tr("library.failedToStartProcessing"));
    },
    [confirmReprocess, process]
  );

  const reprocessSong = useCallback(
    async (song) => {
      if (!song?.id) return;
      if (
        !(await confirmReprocess(
          tr("library.areYouSureYouWantToReArrangeThe2", { 0: song?.title || tr("api.untitled") })
        ))
      )
        return;
      await process(song, api.reprocessMelody, tr("library.failedToReprocessTheMelody"));
    },
    [confirmReprocess, process]
  );

  const deleteSong = useCallback(
    async (song) => {
      if (!song?.id || busy.current.delete.has(song.id)) return;
      busy.current.delete.add(song.id);
      try {
        let confirmed;
        try {
          confirmed = await confirmDialog(
            tr("library.deleteThisWillDeleteAllSongFiles", { 0: song.title }),
            tr("library.deleteASong")
          );
        } catch (error) {
          await notify(tr("library.failedToConfirmDeletion", { 0: getErrorMessage(error) }));
          return;
        }
        if (!confirmed) return;
        setHiddenSongIds((ids) => new Set(ids).add(song.id));
        if (recordingsSongId === song.id) setRecordingsSong(null);
        if (processingSongId === song.id) setProcessingSong(null);
        try {
          await releaseSongMedia(song.id);
          await api.deleteSong(song.id);
        } catch (error) {
          if (!isAmbiguousTransportError(error)) {
            removeFromSet(setHiddenSongIds, song.id);
            await notify(tr("library.failedToDelete", { 0: getErrorMessage(error) }));
            return;
          }
          await notify(
            tr("library.backendDidNotConfirmDeletionCheckingStatus", {
              0: getErrorMessage(error)
            })
          );
          try {
            await onChanged?.();
            removeFromSet(setHiddenSongIds, song.id);
          } catch {
            return;
          }
          return;
        }
        try {
          await onChanged?.();
        } catch (error) {
          await notify(
            tr("library.songDeletedButTheListDidNotRefresh", {
              0: getErrorMessage(error)
            })
          );
        }
      } finally {
        busy.current.delete.delete(song.id);
      }
    },
    [
      confirmDialog,
      notify,
      onChanged,
      processingSongId,
      recordingsSongId,
      setHiddenSongIds,
      setProcessingSong,
      setRecordingsSong
    ]
  );

  const openSongFolder = useCallback(
    async (song) => {
      try {
        const result = await platform.openSongFolder(song);
        if (!result.supported) {
          await notify(tr("library.openingAFolderIsOnlyAvailableInTheInstalled"));
          return;
        }
        if (result.error) await notify(result.error, tr("library.failedToOpenFolder"));
      } catch (error) {
        await notify(
          tr("library.failedToOpenFolder2", { 0: getErrorMessage(error) }),
          tr("library.failedToOpenFolder")
        );
      }
    },
    [notify]
  );

  return { deleteSong, openSongFolder, processSong, reprocessSong };
}
