import { useCallback, useRef } from "react";
import { api } from "../../../api/client";
import { isAmbiguousTransportError } from "../../../api/core";
import { translateSaved as tr } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";

const removeFromSet = (setter, id) =>
  setter((ids) => {
    const next = new Set(ids);
    next.delete(id);
    return next;
  });

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
              ? tr("Backend не подтвердил результат операции: {0}", { 0: getErrorMessage(error) })
              : `${message}: ${getErrorMessage(error)}`
          );
          if (!isAmbiguousTransportError(error)) return;
        }
        setProcessingSong(song);
        try {
          await onChanged?.();
        } catch (error) {
          await notify(
            tr("Операция выполнена, но список не обновился: {0}", {
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
    (song, text) =>
      confirmDialog(
        tr(text, { 0: song?.title || tr("Без названия") }),
        tr("Обработать песню заново?")
      ),
    [confirmDialog]
  );

  const processSong = useCallback(
    async (song) => {
      if (!song?.id) return;
      if (
        song?.status !== "pending" &&
        !(await confirmReprocess(
          song,
          "Вы точно хотите обработать заново песню «{0}»? Ранее созданные результаты обработки будут обновлены."
        ))
      )
        return;
      await process(song, api.processSong, tr("Не удалось запустить обработку"));
    },
    [confirmReprocess, process]
  );

  const reprocessSong = useCallback(
    async (song) => {
      if (!song?.id) return;
      if (
        !(await confirmReprocess(
          song,
          "Вы точно хотите обработать заново песню «{0}»? Текущие данные мелодии будут пересозданы."
        ))
      )
        return;
      await process(song, api.reprocessMelody, tr("Не удалось переобработать мелодию"));
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
            tr("Удалить «{0}»? Это удалит все файлы песни.", { 0: song.title }),
            tr("Удалить песню?")
          );
        } catch (error) {
          await notify(tr("Не удалось подтвердить удаление: {0}", { 0: getErrorMessage(error) }));
          return;
        }
        if (!confirmed) return;
        setHiddenSongIds((ids) => new Set(ids).add(song.id));
        if (recordingsSongId === song.id) setRecordingsSong(null);
        if (processingSongId === song.id) setProcessingSong(null);
        try {
          await api.deleteSong(song.id);
        } catch (error) {
          if (!isAmbiguousTransportError(error)) {
            removeFromSet(setHiddenSongIds, song.id);
            await notify(tr("Не удалось удалить: {0}", { 0: getErrorMessage(error) }));
            return;
          }
          await notify(
            tr("Backend не подтвердил удаление; проверяем состояние: {0}", {
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
            tr("Песня удалена, но список не обновился: {0}", {
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
      if (!globalThis.electronAPI?.openSongFolder) {
        await notify(tr("Открытие папки доступно только в установленном приложении."));
        return;
      }
      try {
        const error = await globalThis.electronAPI.openSongFolder({
          path: song.output_dir ?? "",
          slug: song.slug ?? "",
          title: song.title ?? "",
          id: song.id ?? ""
        });
        if (error) await notify(error, tr("Не удалось открыть папку"));
      } catch (error) {
        await notify(
          tr("Не удалось открыть папку: {0}", { 0: getErrorMessage(error) }),
          tr("Не удалось открыть папку")
        );
      }
    },
    [notify]
  );

  return { deleteSong, openSongFolder, processSong, reprocessSong };
}
