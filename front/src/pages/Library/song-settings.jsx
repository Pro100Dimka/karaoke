import { Music2, Piano, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
import { genreOptions } from "../../constants/music-genres";
import { useAppDialog } from "../../contexts/AppDialog";
import useExclusiveAsyncAction from "../../hooks/useExclusiveAsyncAction";
import { usePolling } from "../../hooks/usePolling";
import { translateSaved as tr } from "../../i18n/runtime";
import { POLLING_INTERVALS } from "../../runtime-config";
import { Button, ConfigForm, Modal, NumberField, Stack, Typography } from "../../theme/ui";
import Field from "../../theme/ui/_internal/Field";
import { getErrorMessage } from "../../utils/errors";

export const HALF = 6;
export const THIRD = 4;
export const FULL = 12;
export const DIFFICULTY_OPTIONS = [
  tr("library.autoByAi"),
  tr("library.easy"),
  tr("library.average"),
  tr("library.difficult"),
  tr("library.expert")
].map((label, index) => ({ value: index ? label : "", label }));
const nullableNumber = (value) => (value === "" || value == null ? null : Number(value));
const field = (name, type, label, span = HALF, extra = {}) => ({
  name,
  type,
  label,
  span,
  getValue: ({ form }) => form?.[name],
  setValue: ({ onChange }, value) => onChange(name, value),
  ...extra
});

export const SONG_FIELDS = [
  field("artist", "text", tr("library.sort.artist"), HALF, { placeholder: "Muse" }),
  field("title", "text", tr("library.songTitle"), HALF, {
    placeholder: tr("library.songTitle"),
    required: true
  }),
  field("tempo_override", "number", tr("karaoke.pace"), THIRD, {
    min: 1,
    parse: "nullable-number"
  }),
  field("key_override", "text", tr("karaoke.key"), THIRD, { placeholder: tr("library.egCM") }),
  field("genre", "select", tr("library.genre"), THIRD, { options: genreOptions() }),
  field("difficulty_override", "select", tr("library.complexity"), HALF, {
    options: DIFFICULTY_OPTIONS
  }),
  {
    name: "note_range",
    type: "custom",
    label: tr("library.noteRange"),
    span: HALF,
    render: ({ context }) => (
      <Field label={tr("library.noteRange")}>
        {({ id }) => (
          <Stack direction="row" gap={1} sx={{ width: "100%" }}>
            {["min", "max"].map((edge) => {
              const name = `note_range_${edge}`;
              return (
                <NumberField
                  key={name}
                  id={`${id}-${edge}`}
                  min={0}
                  max={127}
                  value={context.form?.[name] ?? ""}
                  placeholder={tr(edge === "min" ? "library.from" : "library.to")}
                  aria-label={tr(edge === "min" ? "library.bottomNote" : "library.topNote")}
                  onChange={(value) => context.onChange(name, nullableNumber(value))}
                />
              );
            })}
          </Stack>
        )}
      </Field>
    )
  },
  field("video_url", "text", tr("library.linkToClip"), FULL, {
    placeholder: "https://example.com/video.mp4",
    tooltip: tr("library.youtubeLinksAndDirectLinksToMp4WebmAre")
  })
];

export const getSelectedSong = (songs, id) => {
  const list = Array.isArray(songs) ? songs.filter(Boolean) : [];
  return id ? list.find((song) => song.id === id) : list[0];
};
export const normalizeText = (value) => (typeof value === "string" ? value.trim() || null : null);
const normalizeNumber = (value) => {
  const number = nullableNumber(value);
  return Number.isFinite(number) ? number : null;
};
const midi = (value) => {
  const number = normalizeNumber(value);
  return number == null ? null : Math.max(0, Math.min(127, Math.round(number)));
};
export const validateSongSettings = (form) => {
  if (!normalizeText(form?.title)) return tr("library.enterTheTitleOfTheSong");
  const tempo = normalizeNumber(form.tempo_override);
  if (tempo != null && tempo <= 0) return tr("library.theTempoMustBeGreaterThan0Bpm");
  const [min, max] = [midi(form.note_range_min), midi(form.note_range_max)];
  return max != null && min > max ? tr("library.theBottomNoteOfTheRangeCannotBeHigher") : null;
};
export const createSongPayload = (form, song) => ({
  title: normalizeText(form.title) ?? song.title,
  ...Object.fromEntries(
    ["artist", "genre", "key_override", "difficulty_override", "video_url"].map((key) => [
      key,
      normalizeText(form[key])
    ])
  ),
  tempo_override: normalizeNumber(form.tempo_override),
  note_range_min: midi(form.note_range_min),
  note_range_max: midi(form.note_range_max)
});

export default function SongSettings({ songId, onClose }) {
  const { alert } = useAppDialog();
  const query = usePolling(api.listSongs, POLLING_INTERVALS.health, []);
  const { pending, run } = useExclusiveAsyncAction();
  const song = getSelectedSong(query.data, songId);
  const [form, setForm] = useState(null);
  const navigate = useNavigate();
  useEffect(() => setForm(song ? { ...song } : null), [song]);
  const update = (name, value) => setForm((current) => ({ ...current, [name]: value }));
  const save = () =>
    run(async () => {
      const invalid = validateSongSettings(form);
      if (invalid) return alert(invalid);
      try {
        const updated = await api.updateSong(song.id, createSongPayload(form, song));
        if (updated && typeof updated === "object")
          setForm((current) => ({ ...current, ...updated }));
        await query.refresh?.();
      } catch (error) {
        await alert(tr("library.failedToSave", { 0: getErrorMessage(error) }));
      }
    });
  const content = query.error ? (
    <Stack gap={0.75}>
      <Typography role="alert" tone="danger">
        {tr("library.failedToLoadSong")} {getErrorMessage(query.error)}
      </Typography>
      <Button variant="outlined" onClick={query.refresh}>
        {tr("backend.retry")}
      </Button>
    </Stack>
  ) : !query.data ? (
    <Typography tone="muted">{tr("library.loadingSongSettings")}</Typography>
  ) : !song ? (
    <Typography role="alert" tone="danger">
      {tr("library.songNotFoundItMayHaveBeenDeleted")}
    </Typography>
  ) : !form ? (
    <Typography tone="muted">{tr("library.preparingTheSettings")}</Typography>
  ) : (
    <Stack gap={1}>
      <ConfigForm
        fields={SONG_FIELDS.map((definition) =>
          definition.name === "genre"
            ? { ...definition, options: genreOptions(form.genre) }
            : definition
        )}
        context={{ form, onChange: update }}
        columns={12}
      />
      {song.status === "done" && (
        <CardEditor
          onClick={() => {
            onClose?.();
            navigate(`/editor/${song.id}`);
          }}
        />
      )}
    </Stack>
  );
  return (
    <Modal
      isOpen
      portal
      onClose={onClose}
      ariaLabel={tr("library.songSettings2", { 0: song?.title || "" }).trim()}
      titleProps={{
        icon: Music2,
        eyebrow: tr("library.karaokeEditor"),
        title: tr("library.songSettings"),
        description: song?.title || tr("library.loadingSongData"),
        actions: song && form && (
          <Button variant="contained" startIcon={<Save />} disabled={pending} onClick={save}>
            {tr(pending ? "library.saving" : "library.save")}
          </Button>
        )
      }}
    >
      <Stack sx={{ padding: "var(--space-5)" }}>{content}</Stack>
    </Modal>
  );
}

const CardEditor = ({ onClick }) => (
  <Stack gap={0.5}>
    <Typography sx={{ fontWeight: 800 }}>{tr("library.melodyAndLyrics")}</Typography>
    <Typography variant="body2" tone="muted">
      {tr("library.openThePianoRollEditorToAdjustNotesDurations")}
    </Typography>
    <Button variant="outlined" startIcon={<Piano />} onClick={onClick}>
      {tr("library.openEditor")}
    </Button>
  </Stack>
);
