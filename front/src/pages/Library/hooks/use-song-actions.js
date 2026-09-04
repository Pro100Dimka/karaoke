import { useCallback, useRef } from "react";
import { api } from "../../../api/client";
import { isAmbiguousTransportError } from "../../../api/core";
import { translateSaved as tr } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";
import * as platform from "../../../utils/platform";
import { sameId } from "../utils";

const removeFromSet = (setter, id) =>
  setter((ids) => {
    const next = new Set(ids);
    next.delete(id);
    return next;
  });

const exclusive = async (set, id, action) => {
  if (!id || set.has(id)) return;
  set.add(id);
  try {
    return await action();
  } finally {
    set.delete(id);
  }
};

const mediaUrl = (media) => String(media?.currentSrc || media?.src || "");

export async function releaseSongMedia(songId, root = globalThis.document) {
  if (!songId || !root?.querySelectorAll) return;
  const marker = `/songs/${encodeURIComponent(String(songId))}/`;
  const media = [...root.querySelectorAll("audio, video")].filter((element) =>
    [mediaUrl(element), ...[...(element.querySelectorAll?.("source") || [])].map(mediaUrl)].some(
      (url) => url.includes(marker)
    )
  );

  for (const element of media) {
    try {
      element.pause?.();
      if ("srcObject" in element) element.srcObject = null;
      element.removeAttribute?.("src");
      element.querySelectorAll?.("source").forEach((source) => source.removeAttribute("src"));
      element.load?.();
    } catch {}
  }

  if (media.length) await new Promise((resolve) => globalThis.setTimeout(resolve, 350));
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
    (song, request, errorMessage) =>
      exclusive(busy.current.process, song?.id, async () => {
        try {
          await request(song.id);
        } catch (error) {
          const ambiguous = isAmbiguousTransportError(error);
          await notify(
            ambiguous
              ? tr("library.backendDidNotConfirmTheOperationResult", { 0: getErrorMessage(error) })
              : `${errorMessage}: ${getErrorMessage(error)}`
          );
          if (!ambiguous) return;
        }

        setProcessingSong(song);
        try {
          await onChanged?.();
        } catch (error) {
          await notify(
            tr("library.operationCompletedButTheListDidNotRefresh", { 0: getErrorMessage(error) })
          );
        }
      }),
    [notify, onChanged, setProcessingSong]
  );

  const start = useCallback(
    async (song, request, confirmKey, errorKey) => {
      if (!song?.id) return;
      if (
        confirmKey &&
        !(await confirmDialog(
          tr(confirmKey, { 0: song.title || tr("api.untitled") }),
          tr("library.reworkTheSong")
        ))
      ) {
        return;
      }
      await process(song, request, tr(errorKey));
    },
    [confirmDialog, process]
  );

  const processSong = useCallback(
    (song) =>
      start(
        song,
        api.processSong,
        song?.status === "pending" ? null : "library.areYouSureYouWantToReArrangeThe",
        "library.failedToStartProcessing"
      ),
    [start]
  );

  const reprocessSong = useCallback(
    (song) =>
      start(
        song,
        api.reprocessMelody,
        "library.areYouSureYouWantToReArrangeThe2",
        "library.failedToReprocessTheMelody"
      ),
    [start]
  );

  const deleteSong = useCallback(
    (song) =>
      exclusive(busy.current.delete, song?.id, async () => {
        let confirmed;
        try {
          confirmed = await confirmDialog(
            tr("library.deleteThisWillDeleteAllSongFiles", { 0: song.title }),
            tr("library.deleteASong")
          );
        } catch (error) {
          return notify(tr("library.failedToConfirmDeletion", { 0: getErrorMessage(error) }));
        }
        if (!confirmed) return;

        setHiddenSongIds((ids) => new Set(ids).add(song.id));
        if (sameId(recordingsSongId, song.id)) setRecordingsSong(null);
        if (sameId(processingSongId, song.id)) setProcessingSong(null);

        try {
          await releaseSongMedia(song.id);
          await api.deleteSong(song.id);
        } catch (error) {
          if (!isAmbiguousTransportError(error)) {
            removeFromSet(setHiddenSongIds, song.id);
            return notify(tr("library.failedToDelete", { 0: getErrorMessage(error) }));
          }

          await notify(
            tr("library.backendDidNotConfirmDeletionCheckingStatus", { 0: getErrorMessage(error) })
          );
          try {
            await onChanged?.();
            removeFromSet(setHiddenSongIds, song.id);
          } catch {}
          return;
        }

        try {
          await onChanged?.();
        } catch (error) {
          await notify(
            tr("library.songDeletedButTheListDidNotRefresh", { 0: getErrorMessage(error) })
          );
        }
      }),
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
        if (!result.supported) return notify(tr("library.openingAFolderIsOnlyAvailableInTheInstalled"));
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
