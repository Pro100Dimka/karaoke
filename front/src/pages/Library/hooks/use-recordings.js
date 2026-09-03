import { useState } from "react";
import { api } from "../../../api/client";
import { usePolling } from "../../../hooks/usePolling";
import { translateSaved as tr } from "../../../i18n/runtime";
import { getErrorMessage } from "../../../utils/errors";

export default function useLibraryRecordings(dialog) {
  const [song, setSong] = useState(null);
  const { data, error, refresh } = usePolling(
    () => (song ? api.listRecordingsForSong(song.id) : Promise.resolve([])),
    0,
    [song?.id],
    { queryKey: ["recordings", song?.id ?? null] }
  );
  const remove = async ({ id }) => {
    if (!(await dialog.confirm(tr("karaoke.shouldIDeleteThisRecordedPerformance")))) return;
    try {
      await api.deleteRecording(id);
      await refresh();
    } catch (error) {
      await dialog.alert(tr("karaoke.failedToDeleteEntry", { 0: getErrorMessage(error) }));
    }
  };
  return { song, setSong, delete: remove, error, items: data ?? [] };
}
