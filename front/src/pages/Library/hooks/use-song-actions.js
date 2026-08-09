import { useCallback, useRef } from "react";
import { api } from "../../../api/client";
import { getErrorMessage } from "../../../utils/errors";

const getFolderPayload = ({ output_dir, slug, title, id }) => ({
  path: output_dir ?? "",
  slug: slug ?? "",
  title: title ?? "",
  id: id ?? ""
});

export default function useLibrarySongActions(props) {
  const {
    confirmDialog,
    notify,
    onChanged,
    processingSongId,
    recordingsSongId,
    setHiddenSongIds,
    setProcessingSong,
    setRecordingsSong
  } = props;
  const deletingSongIdsRef = useRef(new Set());
  const processingSongIdsRef = useRef(new Set());

  const runProcessingAction = useCallback(
    async (song, action, errorMessage) => {
      if (!song?.id || processingSongIdsRef.current.has(song.id)) return;
      processingSongIdsRef.current.add(song.id);
      try {
        await action(song.id);
        setProcessingSong(song);
        await onChanged?.();
      } catch (error) {
        await notify(`${errorMessage}: ${getErrorMessage(error)}`);
      } finally {
        processingSongIdsRef.current.delete(song.id);
      }
    },
    [notify, onChanged, setProcessingSong]
  );
  const deleteSong = useCallback(
    async (song) => {
      if (!song?.id || deletingSongIdsRef.current.has(song.id)) return;
      deletingSongIdsRef.current.add(song.id);
      try {
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
          await onChanged?.();
        } catch (error) {
          setHiddenSongIds((ids) => {
            const next = new Set(ids);
            next.delete(song.id);
            return next;
          });
          await notify(`Не удалось удалить: ${getErrorMessage(error)}`);
        }
      } catch (error) {
        await notify(
          `Не удалось подтвердить удаление: ${getErrorMessage(error)}`
        );
      } finally {
        deletingSongIdsRef.current.delete(song.id);
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
  const processSong = useCallback(
    async (song) => {
      const status = String(song?.status || "pending").toLowerCase();
      const isFirstProcessing = status === "pending";

      if (!isFirstProcessing) {
        const confirmed = await confirmDialog(
          `Вы точно хотите обработать заново песню «${song?.title || "Без названия"}»? Ранее созданные результаты обработки будут обновлены.`,
          "Обработать песню заново?"
        );
        if (!confirmed) return;
      }

      await runProcessingAction(
        song,
        api.processSong,
        "Не удалось запустить обработку"
      );
    },
    [confirmDialog, runProcessingAction]
  );
  const reprocessSong = useCallback(
    async (song) => {
      const confirmed = await confirmDialog(
        `Вы точно хотите обработать заново песню «${song?.title || "Без названия"}»? Текущие данные мелодии будут пересозданы.`,
        "Обработать песню заново?"
      );
      if (!confirmed) return;

      await runProcessingAction(
        song,
        api.reprocessMelody,
        "Не удалось переобработать MIDI"
      );
    },
    [confirmDialog, runProcessingAction]
  );
  const openSongFolder = useCallback(
    async (song) => {
      const openFolder = window.electronAPI?.openSongFolder;
      if (!openFolder) {
        await notify(
          "Открытие папки доступно только в установленном приложении."
        );
        return;
      }

      try {
        const errorMessage = await openFolder(getFolderPayload(song));
        if (errorMessage)
          await notify(errorMessage, "Не удалось открыть папку");
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
