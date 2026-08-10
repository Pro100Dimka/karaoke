import { Music2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../../api/client";
import Button from "../../../../components/fields/button";
import Modal from "../../../../components/modal";
import { useAppDialog } from "../../../../contexts/AppDialog";
import useExclusiveAsyncAction from "../../../../hooks/useExclusiveAsyncAction";
import { usePolling } from "../../../../hooks/usePolling";
import { ConfigForm, NumberField, Stack } from "../../../../theme/ui";
import { getErrorMessage } from "../../../../utils/errors";

import { SONG_FIELDS } from "./config";
import {
  createSongPayload,
  getSelectedSong,
  validateSongSettings
} from "./utils";

const setField = (setter, name, value) =>
  setter((current) => ({ ...current, [name]: value }));

const parseNumber = (value) =>
  value === "" || value == null ? null : Number(value);

const SONG_RENDERERS = {
  noteRange: ({ field, context }) => (
    <Stack gap={1}>
      <strong>{field.label}</strong>

      <Stack direction="row" gap={2}>
        <NumberField
          placeholder="Мин."
          value={context.form?.note_range_min ?? ""}
          onChange={(value) =>
            context.onChange("note_range_min", parseNumber(value))
          }
        />

        <NumberField
          placeholder="Макс."
          value={context.form?.note_range_max ?? ""}
          onChange={(value) =>
            context.onChange("note_range_max", parseNumber(value))
          }
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
  } = usePolling(api.listSongs, 5000, []);
  const { pending: saving, run: runSave } = useExclusiveAsyncAction();

  const song = getSelectedSong(songs, songId);
  const [form, setForm] = useState(null);

  useEffect(() => {
    setForm(song ? { ...song } : null);
  }, [song]);

  const updateField = (name, value) => setField(setForm, name, value);

  const save = () =>
    runSave(async () => {
      if (!song || !form) return;

      const validationError = validateSongSettings(form);
      if (validationError) {
        await notify(validationError);
        return;
      }

      try {
        const updated = await api.updateSong(
          song.id,
          createSongPayload(form, song)
        );

        if (updated && typeof updated === "object") {
          setForm((current) => ({ ...current, ...updated }));
        }

        await refreshSongs?.();
      } catch (error) {
        await notify(`Не удалось сохранить: ${getErrorMessage(error)}`);
      }
    });

  return (
    <Modal
      isOpen
      portal
      onClose={onClose}
      ariaLabel={`Настройки песни ${song?.title || ""}`.trim()}
      titleProps={{
        icon: Music2,
        eyebrow: "КАРАОКЕ · РЕДАКТОР",
        title: "Настройки песни",
        description: song?.title || "Загружаем данные песни…",
        actions: song && form ? (
          <Button
            icon={Save}
            variant="primary"
            disabled={saving}
            onClick={save}
            className="modal-title-action"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
        ) : null
      }}
    >
      {songsError ? (
        <Stack gap={1} sx={{ padding: "1rem" }}>
          <p className="field-error">
            Не удалось загрузить песню: {getErrorMessage(songsError)}
          </p>
          <Button variant="ghost" onClick={() => refreshSongs?.()}>
            Повторить
          </Button>
        </Stack>
      ) : !songs ? (
        <p className="text-muted" style={{ padding: "1rem" }}>
          Загружаем настройки песни…
        </p>
      ) : !song ? (
        <p className="field-error" style={{ padding: "1rem" }}>
          Песня не найдена. Возможно, она была удалена.
        </p>
      ) : !form ? (
        <p className="text-muted" style={{ padding: "1rem" }}>
          Подготавливаем настройки…
        </p>
      ) : (
        <ConfigForm
          fields={SONG_FIELDS}
          context={{ form, onChange: updateField }}
          renderers={SONG_RENDERERS}
          columns={12}
          sx={{ padding: "1rem" }}
        />
      )}
    </Modal>
  );
}
