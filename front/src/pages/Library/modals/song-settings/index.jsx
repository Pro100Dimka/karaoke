import { Music2, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { api } from "../../../../api/client";
import FieldInput, { FieldList, FieldRow } from "../../../../components/fields";
import Button from "../../../../components/fields/button";
import Modal from "../../../../components/modal";
import { Panel } from "../../../../components/ui";
import { useAppDialog } from "../../../../contexts/AppDialog";
import useExclusiveAsyncAction from "../../../../hooks/useExclusiveAsyncAction";
import { usePolling } from "../../../../hooks/usePolling";
import { getErrorMessage } from "../../../../utils/errors";
import {
  FIELD_BY_NAME,
  LYRICS_FIELD,
  NOTE_RANGE_FIELDS,
  SONG_FIELD_ROWS,
  SONG_FIELDS_AFTER_RANGE
} from "./config";
import useSongLyrics from "./hooks/use-song-lyrics";
import { createSongPayload, getSelectedSong } from "./utils";

const setField = (setter, name, value) =>
  setter((current) => ({ ...current, [name]: value }));

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
  const actions = [
    [
      Save,
      saving ? "Сохранение…" : "Сохранить",
      "primary",
      save,
      { disabled: saving }
    ]
  ];

  return (
    <Modal
      isOpen
      portal
      onClose={onClose}
      ariaLabel={`Настройки песни ${song.title}`}
      modalClassName="song-settings-modal"
      titleProps={{
        icon: Music2,
        eyebrow: "КАРАОКЕ · РЕДАКТОР",
        title: "Настройки песни",
        description: song.title,
        actions: actions.map(
          ([Icon, text, variant, onClick, { disabled = false, iconProps } = {}]) => (
            <Button
              key={text}
              icon={Icon}
              variant={variant}
              disabled={disabled}
              iconProps={iconProps}
              onClick={onClick}
              className="modal-title-action"
            >
              {text}
            </Button>
          )
        )
      }}
    >
      <div className="song-settings-scroll modal-scroll">
        <div className="song-settings-workspace">
          <section className="song-settings-panel">
            <div className="song-settings-panel-body">
              <SongFields form={form} onChange={updateField} />
            </div>
          </section>

          {song.status === "done" && (
            <LyricsEditor lyrics={lyrics} onChange={updateLyricsText} />
          )}
        </div>
      </div>
    </Modal>
  );
}

function SongFields({ form, onChange }) {
  return (
    <div className="song-settings-fields">
      {SONG_FIELD_ROWS.map((names) => (
        <div
          key={names.join("-")}
          className={`song-settings-field-row song-settings-field-row--${names.length}`}
        >
          {names.map((name) => (
            <FieldInput
              key={name}
              field={FIELD_BY_NAME[name]}
              value={form[name]}
              onChange={(value) => onChange(name, value)}
            />
          ))}
        </div>
      ))}
      <div className="song-settings-field-row song-settings-field-row--2">
        <FieldInput
          field={FIELD_BY_NAME.difficulty_override}
          value={form.difficulty_override}
          onChange={(value) => onChange("difficulty_override", value)}
        />
        <NoteRangeFields form={form} onChange={onChange} />
      </div>
      <FieldList
        fields={SONG_FIELDS_AFTER_RANGE}
        values={form}
        onChange={onChange}
      />
    </div>
  );
}

function NoteRangeFields({ form, onChange }) {
  return (
    <div className="settings-field song-settings-note-range">
      <strong>Диапазон нот (MIDI)</strong>
      <FieldRow>
        {NOTE_RANGE_FIELDS.map((field) => (
          <FieldInput
            bare
            key={field.name}
            field={field}
            value={form[field.name]}
            onChange={(value) => onChange(field.name, value)}
          />
        ))}
      </FieldRow>
    </div>
  );
}

function LyricsEditor({ lyrics, onChange }) {
  return (
    <section className="song-settings-panel song-lyrics-panel">
      <div className="song-settings-panel-body song-lyrics-body">
        <div className="song-lyrics-field">
          <FieldInput
            field={LYRICS_FIELD}
            value={lyrics.text}
            onChange={onChange}
          />
        </div>
        {lyrics.error && <p className="song-lyrics-error">{lyrics.error}</p>}
      </div>
    </section>
  );
}
