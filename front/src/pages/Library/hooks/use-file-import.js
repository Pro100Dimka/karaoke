import { useCallback } from "react";
import { api } from "../../../api/client";
import useExclusiveAsyncAction from "../../../hooks/useExclusiveAsyncAction";
import { translateSaved } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";

export default function useLibraryFileImport({ fileInputRef, notify, onStarted }) {
  const { pending, run } = useExclusiveAsyncAction();
  const openFilePicker = useCallback(() => {
    if (!pending) fileInputRef.current?.click();
  }, [fileInputRef, pending]);
  const importFile = useCallback(
    async (event) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;
      await run(async () => {
        let song;
        try {
          song = await api.addSong(file, file.name.replace(/\.[^.]+$/, ""));
        } catch (error) {
          await notify(
            translateSaved("Не удалось добавить песню: {0}", { 0: getErrorMessage(error) })
          );
          return;
        }
        try {
          await api.processSong(song.id);
          onStarted(song);
        } catch (error) {
          const ambiguous =
            !error?.status || error.name === "TimeoutError" || error.name === "AbortError";
          if (ambiguous) {
            onStarted(song);
            await notify(
              translateSaved("Песня добавлена, но backend не подтвердил запуск обработки: {0}", {
                0: getErrorMessage(error)
              })
            );
            return;
          }
          await api.deleteSong(song.id).catch(() => {});
          await notify(
            translateSaved("Не удалось запустить обработку песни: {0}", {
              0: getErrorMessage(error)
            })
          );
        }
      });
    },
    [notify, onStarted, run]
  );
  return { importing: pending, importFile, openFilePicker };
}
