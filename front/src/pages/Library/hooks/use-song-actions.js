import { useCallback, useRef } from "react";
import { api } from "../../../api/client";
import { translateSaved } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";

function getFolderPayload({ output_dir, slug, title, id }) {
  return { path: output_dir ?? "", slug: slug ?? "", title: title ?? "", id: id ?? "" };
}
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
        try {
          await action(song.id);
        } catch (error) {
          await notify(`${errorMessage}: ${getErrorMessage(error)}`);
          return;
        }
        setProcessingSong(song);
        try {
          await onChanged?.();
        } catch (error) {
          await notify(
            translateSaved("Операция выполнена, но список не обновился: {0}", {
              0: getErrorMessage(error)
            })
          );
        }
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
        let confirmed;
        try {
          confirmed = await confirmDialog(
            translateSaved("Удалить «{0}»? Это удалит все файлы песни.", { 0: song.title }),
            translateSaved("Удалить песню?")
          );
        } catch (error) {
          await notify(
            translateSaved("Не удалось подтвердить удаление: {0}", { 0: getErrorMessage(error) })
          );
          return;
        }
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
          await notify(translateSaved("Не удалось удалить: {0}", { 0: getErrorMessage(error) }));
          return;
        }
        try {
          await onChanged?.();
        } catch (error) {
          await notify(
            translateSaved("Песня удалена, но список не обновился: {0}", {
              0: getErrorMessage(error)
            })
          );
        }
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
          translateSaved(
            "Вы точно хотите обработать заново песню «{0}»? Ранее созданные результаты обработки будут обновлены.",
            { 0: song.title || translateSaved("Без названия") }
          ),
          translateSaved("Обработать песню заново?")
        );
        if (!confirmed) return;
      }
      await runProcessingAction(
        song,
        api.processSong,
        translateSaved("Не удалось запустить обработку")
      );
    },
    [confirmDialog, runProcessingAction]
  );
  const reprocessSong = useCallback(
    async (song) => {
      const confirmed = await confirmDialog(
        translateSaved(
          "Вы точно хотите обработать заново песню «{0}»? Текущие данные мелодии будут пересозданы.",
          { 0: song?.title || translateSaved("Без названия") }
        ),
        translateSaved("Обработать песню заново?")
      );
      if (!confirmed) return;
      await runProcessingAction(
        song,
        api.reprocessMelody,
        translateSaved("Не удалось переобработать MIDI")
      );
    },
    [confirmDialog, runProcessingAction]
  );
  const openSongFolder = useCallback(
    async (song) => {
      const openFolder = window.electronAPI?.openSongFolder;
      if (!openFolder) {
        await notify(translateSaved("Открытие папки доступно только в установленном приложении."));
        return;
      }
      try {
        const errorMessage = await openFolder(getFolderPayload(song));
        if (errorMessage) await notify(errorMessage, translateSaved("Не удалось открыть папку"));
      } catch (error) {
        await notify(
          translateSaved("Не удалось открыть папку: {0}", { 0: getErrorMessage(error) }),
          translateSaved("Не удалось открыть папку")
        );
      }
    },
    [notify]
  );
  return { deleteSong, openSongFolder, processSong, reprocessSong };
}
