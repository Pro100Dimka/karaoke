import { useCallback, useEffect, useState } from "react";
import { api } from "../../../../api/client";
import { translateSaved } from "../../../../i18n/runtime";
import { getErrorMessage } from "../../../../utils/errors";

export default function useMelodyEditorDocument({
  confirmDialog,
  notes,
  notify,
  onSaved,
  reset,
  saveRef,
  setSelected,
  song
}) {
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    if (!song?.id) return;
    setLoading(true);
    try {
      const result = await api.getSongEditor(song.id);
      setPayload(result);
      reset(result?.song_map?.notes || result?.song_map?.display_notes || []);
      setSelected([]);
    } catch (error) {
      await notify(
        translateSaved("Не удалось открыть редактор: {0}", { 0: getErrorMessage(error) })
      );
    } finally {
      setLoading(false);
    }
  }, [notify, reset, setSelected, song?.id]);

  useEffect(() => { load(); }, [load]);

  const save = useCallback(async () => {
    setSaving(true);
    try {
      const serializable = notes.map(({ _id: _, ...note }) => note);
      const result = await api.saveSongEditor(song.id, serializable);
      setPayload(result);
      reset(result.song_map?.notes || serializable);
      setSelected([]);
      await onSaved?.();
    } catch (error) {
      await notify(
        translateSaved("Не удалось сохранить редактор: {0}", { 0: getErrorMessage(error) })
      );
    } finally {
      setSaving(false);
    }
  }, [notes, notify, onSaved, reset, setSelected, song?.id]);
  saveRef.current = save;

  const restoreAi = useCallback(async () => {
    if (
      !payload?.ai_backup_exists ||
      !(await confirmDialog(
        translateSaved( "Вернуть исходный результат AI? Ручные изменения будут потеряны."
        )
      ))
    )
      return;
    try {
      const result = await api.resetSongEditor(song.id);
      setPayload(result);
      reset(result.song_map?.notes || []);
      setSelected([]);
      await onSaved?.();
    } catch (error) {
      await notify( translateSaved("Не удалось восстановить AI: {0}", { 0: getErrorMessage(error) })
      );
    }
  }, [
    confirmDialog,
    notify,
    onSaved,
    payload?.ai_backup_exists,
    reset,
    setSelected,
    song?.id
  ]);

  return { loading, payload, restoreAi, save, saving };
}
