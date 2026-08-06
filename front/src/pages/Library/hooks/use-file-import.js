import { useCallback } from "react";
import { api } from "../../../api/client";
import { getErrorMessage } from "../../../utils/errors";

export default function useLibraryFileImport({ fileInputRef, notify, onStarted }) {
  const openFilePicker = useCallback(() => fileInputRef.current?.click(), [fileInputRef]);

  const importFile = useCallback(
    async (event) => {
      const input = event.currentTarget;
      const file = input.files?.[0];
      input.value = "";
      if (!file) return;

      try {
        const song = await api.addSong(file, file.name.replace(/\.[^.]+$/, ""));
        await api.processSong(song.id);
        onStarted(song);
      } catch (error) {
        await notify(
          `Не удалось добавить и запустить обработку песни: ${getErrorMessage(error)}`
        );
      }
    },
    [notify, onStarted]
  );

  return { importFile, openFilePicker };
}
