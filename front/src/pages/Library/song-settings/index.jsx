import { useEffect, useState } from "react";
import { api } from "../../../api/client";
import FieldInput, { FieldList, FieldRow } from "../../../components/fields";
import Button from "../../../components/fields/button";
import { Panel } from "../../../components/ui";
import { useAppDialog } from "../../../contexts/AppDialog";
import { usePolling } from "../../../hooks/usePolling";
import { EMPTY_LYRICS, NOTE_RANGE_FIELDS, SONG_FIELDS } from "./config";
import {
  buildLyricsData,
  createSongPayload,
  getSelectedSong,
  lyricsToText,
  parseLyricsText
} from "./utils";

const LYRICS_FIELD = {
  name: "lyrics",
  label: "Текст песни",
  type: "textarea",
  rows: 16,
  spellCheck: false,
  className: "song-lyrics-editor",
  hint: "Каждая строка — отдельная строка песни. Тайминги сохраняются автоматически."
};

const SONG_FIELDS_BEFORE_RANGE = SONG_FIELDS.slice(0, 5);
const SONG_FIELDS_AFTER_RANGE = SONG_FIELDS.slice(5);

export default function SongSettings({ songId }) {
  const { alert: notify } = useAppDialog();
  const { data: songs } = usePolling(api.listSongs, 5000, []);

  const song = getSelectedSong(songs, songId);

  const [form, setForm] = useState(null);
  const [saving, setSaving] = useState(false);
  const [lyrics, setLyrics] = useState(EMPTY_LYRICS);

  useEffect(() => {
    setForm(song ? { ...song } : null);
  }, [song?.id]);

  useEffect(() => {
    let active = true;

    async function loadLyrics() {
      if (!song || song.status !== "done") {
        if (active) setLyrics(EMPTY_LYRICS);
        return;
      }

      try {
        const result = await api.getResult(song.id);

        if (!active) return;

        const data = Array.isArray(result?.lyrics_sync)
          ? result.lyrics_sync
          : [];

        setLyrics({
          data,
          text: lyricsToText(data),
          error: null
        });
      } catch (error) {
        if (!active) return;

        setLyrics({
          ...EMPTY_LYRICS,
          error: error?.message ?? null
        });
      }
    }

    loadLyrics();

    return () => {
      active = false;
    };
  }, [song?.id, song?.status]);

  if (!song || !form) {
    return (
      <Panel title="Настройки песни">
        <p className="text-muted">Нет песен — добавьте песню в Библиотеке.</p>
      </Panel>
    );
  }

  const updateField = (field, value) => {
    setForm((current) => ({
      ...current,
      [field]: value
    }));
  };

  const updateLyricsText = (text) => {
    setLyrics((current) => ({
      ...current,
      text,
      error: null
    }));
  };

  const saveLyrics = async () => {
    const textLines = parseLyricsText(lyrics.text);

    if (textLines.length > lyrics.data.length) {
      setLyrics((current) => ({
        ...current,
        error:
          "Нельзя добавить новые строки без таймингов. Сначала добавьте их при обработке песни."
      }));

      return false;
    }

    try {
      const data = buildLyricsData(lyrics.data, textLines);

      await api.updateLyrics(song.id, data);

      setLyrics({
        data,
        text: lyricsToText(data),
        error: null
      });

      return true;
    } catch (error) {
      setLyrics((current) => ({
        ...current,
        error: error?.message ?? "Не удалось сохранить текст"
      }));

      return false;
    }
  };

  const save = async () => {
    if (saving) return;

    setSaving(true);

    try {
      if (song.status === "done" && !(await saveLyrics())) {
        return;
      }

      await api.updateSong(song.id, createSongPayload(form, song));
    } catch (error) {
      await notify(
        `Не удалось сохранить: ${error?.message ?? "Неизвестная ошибка"}`
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="song-settings-shell">
      <div className="song-settings-scroll modal-scroll">
        <div className="song-settings-workspace">
          <Panel
            className="ui-card song-settings-panel"
            title={`Настройки песни — ${song.title}`}
          >
            <SongFields form={form} onChange={updateField} />

            <Button
              className="song-settings-save"
              variant="primary"
              disabled={saving}
              onClick={save}
            >
              {saving ? "Сохранение..." : "Сохранить"}
            </Button>
          </Panel>

          {song.status === "done" && (
            <LyricsEditor lyrics={lyrics} onChange={updateLyricsText} />
          )}
        </div>
      </div>
    </div>
  );
}

function SongFields({ form, onChange }) {
  return (
    <div className="song-settings-fields">
      <FieldList
        fields={SONG_FIELDS_BEFORE_RANGE}
        values={form}
        onChange={onChange}
      />
      <NoteRangeFields form={form} onChange={onChange} />
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
    <div className="settings-field">
      <span>
        <strong>Диапазон нот (MIDI)</strong>
      </span>
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
    <Panel className="ui-card song-settings-panel song-lyrics-panel" title="Редактор текста">
      <div className="song-lyrics-field">
        <FieldInput
          field={LYRICS_FIELD}
          value={lyrics.text}
          onChange={onChange}
        />
      </div>

      {lyrics.error && <p className="song-lyrics-error">{lyrics.error}</p>}
    </Panel>
  );
}
