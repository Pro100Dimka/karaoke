import { useCallback } from "react";
import { api } from "../../../api/client";
import { getErrorMessage } from "../../../utils/errors";

export default function useLibrarySongActions({
  confirmDialog,
  notify,
  processingSongId,
  recordingsSongId,
  setHiddenSongIds,
  setProcessingSong,
  setRecordingsSong
}) {
  const deleteSong = useCallback(
    async (song) => {
      const confirmed = await confirmDialog(
        `Удалить «${song.title}»? Это удалит все файлы песни.`,
        "Удалить песню?"
      );
      if (!confirmed) return;

      setHiddenSongIds((ids) => new Set(ids).add(song.id));
      if (recordingsSongId === song.id) setRecordingsSong(null);
      if (processingSongId === song.id) setProcessingSong(null);

      try {
        await api.deleteSong(song.id);
      } catch (error) {
        setHiddenSongIds((ids) => {
          const next = new Set(ids);
          next.delete(song.id);
          return next;
        });
        await notify(`Не удалось удалить: ${getErrorMessage(error)}`);
      }
    },
    [
      confirmDialog,
      notify,
      processingSongId,
      recordingsSongId,
      setHiddenSongIds,
      setProcessingSong,
      setRecordingsSong
    ]
  );

  const processSong = useCallback(
    async (song) => {
      try {
        await api.processSong(song.id);
        setProcessingSong(song);
      } catch (error) {
        await notify(
          `Не удалось запустить обработку: ${getErrorMessage(error)}`
        );
      }
    },
    [notify, setProcessingSong]
  );

  const reprocessSong = useCallback(
    async (song) => {
      try {
        await api.reprocessMelody(song.id);
        setProcessingSong(song);
      } catch (error) {
        await notify(
          `Не удалось переобработать MIDI: ${getErrorMessage(error)}`
        );
      }
    },
    [notify, setProcessingSong]
  );

  const openSongFolder = useCallback(
    async (song) => {
      if (!window.electronAPI?.openSongFolder) {
        await notify(
          "Открытие папки доступно только в установленном приложении."
        );
        return;
      }

      try {
        const errorMessage = await window.electronAPI.openSongFolder({
          path: song.output_dir || "",
          slug: song.slug || "",
          title: song.title || "",
          id: song.id || ""
        });

        if (errorMessage) {
          await notify(errorMessage, "Не удалось открыть папку");
        }
      } catch (error) {
        await notify(
          `Не удалось открыть папку: ${getErrorMessage(error)}`,
          "Не удалось открыть папку"
        );
      }
    },
    [notify]
  );

  return { deleteSong, openSongFolder, processSong, reprocessSong };
}
