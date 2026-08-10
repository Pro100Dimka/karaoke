import { Music2, Save } from "lucide-react";
import { useEffect, useState } from "react";

import { api } from "../../../../api/client";
import Button from "../../../../components/fields/button";
import Modal from "../../../../components/modal";
import { Panel } from "../../../../components/ui";
import { useAppDialog } from "../../../../contexts/AppDialog";
import useExclusiveAsyncAction from "../../../../hooks/useExclusiveAsyncAction";
import { usePolling } from "../../../../hooks/usePolling";
import { ConfigForm, NumberField, Stack } from "../../../../theme/ui";
import { getErrorMessage } from "../../../../utils/errors";

import { SONG_FIELDS } from "./config";
import useSongLyrics from "./hooks/use-song-lyrics";
import { createSongPayload, getSelectedSong } from "./utils";

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
  const { data: songs } = usePolling(api.listSongs, 5000, []);
  const { pending: saving, run: runSave } = useExclusiveAsyncAction();

  const song = getSelectedSong(songs, songId);
  const [form, setForm] = useState(null);
  const { lyrics, saveLyrics, updateLyricsText } = useSongLyrics(song);

  useEffect(() => {
    setForm(song ? { ...song } : null);
  }, [song]);

  if (!song || !form) {
    return (
      <Panel title="Настройки песни">
        <p className="text-muted">Нет песен — добавьте песню в Библиотеке.</p>
      </Panel>
    );
  }

  const updateField = (name, value) => setField(setForm, name, value);

  const save = () =>
    runSave(async () => {
      try {
        if (song.status === "done" && !(await saveLyrics())) return;
        await api.updateSong(song.id, createSongPayload(form, song));
      } catch (error) {
        await notify(`Не удалось сохранить: ${getErrorMessage(error)}`);
      }
    });

  return (
    <Modal
      isOpen
      portal
      onClose={onClose}
      ariaLabel={`Настройки песни ${song.title}`}
      titleProps={{
        icon: Music2,
        eyebrow: "КАРАОКЕ · РЕДАКТОР",
        title: "Настройки песни",
        description: song.title,
        actions: (
          <Button
            icon={Save}
            variant="primary"
            disabled={saving}
            onClick={save}
            className="modal-title-action"
          >
            {saving ? "Сохранение…" : "Сохранить"}
          </Button>
        )
      }}
    >
      <ConfigForm
        fields={SONG_FIELDS}
        context={{ form, onChange: updateField }}
        renderers={SONG_RENDERERS}
        columns={12}
        sx={{ padding: "1rem" }}
      />
    </Modal>
  );
}
