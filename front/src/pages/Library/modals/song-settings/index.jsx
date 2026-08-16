import { Music2, Piano, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../../../api/client";
import Button from "../../../../components/fields/button";
import Modal from "../../../../components/modal";
import { useAppDialog } from "../../../../contexts/AppDialog";
import useExclusiveAsyncAction from "../../../../hooks/useExclusiveAsyncAction";
import { usePolling } from "../../../../hooks/usePolling";
import { translateSaved } from "../../../../i18n/runtime";
import { POLLING_INTERVALS } from "../../../../runtime-config";
import { ConfigForm, NumberField, Stack } from "../../../../theme/ui";
import { getErrorMessage } from "../../../../utils/errors";
import { SONG_FIELDS } from "./config";
import { createSongPayload, getSelectedSong, validateSongSettings } from "./utils";

const setField = (setter, name, value) => setter((current) => ({ ...current, [name]: value }));
const parseNumber = (value) => (value === "" || value == null ? null : Number(value));
const SONG_RENDERERS = {
  noteRange: ({ field, context }) => (
    <Stack gap={1}>
      <strong>{field.label}</strong>

      <Stack direction="row" gap={2}>
        <NumberField
          placeholder={translateSaved("Мин.")}
          value={context.form.note_range_min ?? ""}
          onChange={(value) => context.onChange("note_range_min", parseNumber(value))}
        />

        <NumberField
          placeholder={translateSaved("Макс.")}
          value={context.form.note_range_max ?? ""}
          onChange={(value) => context.onChange("note_range_max", parseNumber(value))}
        />
      </Stack>
    </Stack>
  )
};
export default function SongSettings({ songId, onClose }) {
  const { alert: notify } = useAppDialog();
  const {
    data: songs,
    error: songsError,
    refresh: refreshSongs
  } = usePolling(api.listSongs, POLLING_INTERVALS.health, []);
  const { pending: saving, run: runSave } = useExclusiveAsyncAction();
  const song = getSelectedSong(songs, songId);
  const [form, setForm] = useState(null);
  const navigate = useNavigate();
  useEffect(() => {
    setForm(song ? { ...song } : null);
  }, [song]);
  const updateField = (name, value) => setField(setForm, name, value);
  const save = () =>
    runSave(async () => {
      const validationError = validateSongSettings(form);
      if (validationError) {
        await notify(validationError);
        return;
      }
      try {
        const updated = await api.updateSong(song.id, createSongPayload(form, song));
        if (updated && typeof updated === "object")
          setForm((current) => ({ ...current, ...updated }));
        await refreshSongs?.();
      } catch (error) {
        await notify(translateSaved("Не удалось сохранить: {0}", { 0: getErrorMessage(error) }));
      }
    });
  const renderContent = () => {
    if (songsError) {
      return (
        <Stack gap={1} sx={{ padding: "1rem" }}>
          <p className="field-error">
            {translateSaved("Не удалось загрузить песню:")}
            {getErrorMessage(songsError)}
          </p>
          <Button variant="ghost" onClick={() => refreshSongs?.()}>
            {translateSaved("Повторить")}
          </Button>
        </Stack>
      );
    }
    if (!songs) {
      return (
        <p className="text-muted" style={{ padding: "1rem" }}>
          {translateSaved("Загружаем настройки песни…")}
        </p>
      );
    }
    if (!song) {
      return (
        <p className="field-error" style={{ padding: "1rem" }}>
          {translateSaved("Песня не найдена. Возможно, она была удалена.")}
        </p>
      );
    }
    if (!form) {
      return (
        <p className="text-muted" style={{ padding: "1rem" }}>
          {translateSaved("Подготавливаем настройки…")}
        </p>
      );
    }
    return (
      <Stack gap={2} sx={{ padding: "1rem" }}>
        <ConfigForm
          fields={SONG_FIELDS}
          context={{ form, onChange: updateField }}
          renderers={SONG_RENDERERS}
          columns={12}
        />
        {song.status === "done" && (
          <Stack gap={0.6}>
            <strong>{translateSaved("Мелодия и текст")}</strong>
            <span className="text-muted">
              {translateSaved(
                "Откройте piano-roll редактор, чтобы на слух и визуально исправить ноты, длительность и привязку текста."
              )}
            </span>
            <Button
              icon={Piano}
              variant="ghost"
              onClick={() => {
                onClose?.();
                navigate(`/editor/${song.id}`);
              }}
            >
              {translateSaved("Открыть редактор")}
            </Button>
          </Stack>
        )}
      </Stack>
    );
  };
  return (
    <Modal
      isOpen
      portal
      onClose={onClose}
      ariaLabel={translateSaved("Настройки песни {0}", { 0: song?.title || "" }).trim()}
      titleProps={{
        icon: Music2,
        eyebrow: translateSaved("КАРАОКЕ · РЕДАКТОР"),
        title: translateSaved("Настройки песни"),
        description: song?.title || translateSaved("Загружаем данные песни…"),
        actions:
          song && form ? (
            <Button
              icon={Save}
              variant="primary"
              disabled={saving}
              onClick={save}
              className="modal-title-action"
            >
              {saving ? translateSaved("Сохранение…") : translateSaved("Сохранить")}
            </Button>
          ) : null
      }}
    >
      {renderContent()}
    </Modal>
  );
}
