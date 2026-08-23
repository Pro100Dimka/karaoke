import { useCallback, useEffect, useReducer, useState } from "react";
import { api } from "../../api/client";
import { translateSaved as t } from "../../i18n/runtime";
import { getErrorMessage } from "../../utils/errors";
import { prepareEditorNotes } from "../../workers/editor-client";
import { documentReducer, initialDocument, serializeNotes } from "./model";

export default function useEditorDocument({ songId, confirm, notify }) {
  const [song, setSong] = useState(null);
  const [payload, setPayload] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [document, dispatch] = useReducer(documentReducer, initialDocument);

  useEffect(() => {
    if (!songId) return undefined;
    let active = true;
    api
      .listSongs()
      .then((songs) => {
        if (!active) return;
        setSong(
          (songs || []).find(({ id }) => String(id) === String(songId)) || {
            id: songId,
            title: t("Редактор мелодии")
          }
        );
      })
      .catch(() => active && setSong({ id: songId, title: t("Редактор мелодии") }));
    return () => {
      active = false;
    };
  }, [songId]);

  const accept = useCallback(async (result) => {
    const notes = await prepareEditorNotes(result?.lyrics_sync);
    setPayload(result);
    const wordTexts = (result?.lyrics_sync?.words || []).map((word) => String(word.text || ""));
    dispatch({ type: "load", notes, wordTexts });
  }, []);

  const load = useCallback(async () => {
    if (!song?.id) return;
    setLoading(true);
    try {
      await accept(await api.getSongEditor(song.id));
    } catch (error) {
      await notify(t("Не удалось открыть редактор: {0}", { 0: getErrorMessage(error) }));
    } finally {
      setLoading(false);
    }
  }, [accept, notify, song?.id]);

  useEffect(() => {
    load();
  }, [load]);

  const save = useCallback(async () => {
    if (!song?.id) return;
    setSaving(true);
    try {
      const raw = serializeNotes(document.notes, payload?.lyrics_sync?.words || []);
      await accept(await api.saveSongEditor(song.id, raw, document.wordTexts));
    } catch (error) {
      await notify(t("Не удалось сохранить редактор: {0}", { 0: getErrorMessage(error) }));
    } finally {
      setSaving(false);
    }
  }, [accept, document.notes, document.wordTexts, notify, payload?.lyrics_sync?.words, song?.id]);

  const restore = useCallback(async () => {
    if (
      !song?.id ||
      !payload?.ai_backup_exists ||
      !(await confirm(t("Вернуть исходный результат AI? Ручные изменения будут потеряны.")))
    )
      return;
    try {
      await accept(await api.resetSongEditor(song.id));
    } catch (error) {
      await notify(t("Не удалось восстановить AI: {0}", { 0: getErrorMessage(error) }));
    }
  }, [accept, confirm, notify, payload?.ai_backup_exists, song?.id]);

  return { dispatch, document, load, loading, payload, restore, save, saving, song };
}
