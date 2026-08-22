import { Music2, Piano, Save } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../../api/client";
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
  tr("Авто (по AI)"),
  tr("Лёгкий"),
  tr("Средний"),
  tr("Сложный"),
  tr("Эксперт")
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
  field("artist", "text", tr("Исполнитель"), HALF, { placeholder: "Muse" }),
  field("title", "text", tr("Название песни"), HALF, {
    placeholder: tr("Название песни"),
    required: true
  }),
  field("tempo_override", "number", tr("Темп"), THIRD, { min: 1, parse: "nullable-number" }),
  field("key_override", "text", tr("Тональность"), THIRD, { placeholder: tr("напр. C#m") }),
  field("genre", "text", tr("Жанр"), THIRD, { placeholder: "Alternative rock" }),
  field("difficulty_override", "select", tr("Сложность"), HALF, { options: DIFFICULTY_OPTIONS }),
  {
    name: "note_range",
    type: "custom",
    label: tr("Диапазон нот"),
    span: HALF,
    render: ({ context }) => (
      <Field label={tr("Диапазон нот")}>
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
                  placeholder={tr(edge === "min" ? "От" : "До")}
                  aria-label={tr(edge === "min" ? "Нижняя нота" : "Верхняя нота")}
                  onChange={(value) => context.onChange(name, nullableNumber(value))}
                />
              );
            })}
          </Stack>
        )}
      </Field>
    )
  },
  field("video_url", "text", tr("Ссылка на клип"), FULL, {
    placeholder: "https://example.com/video.mp4",
    tooltip: tr(
      "Поддерживаются YouTube-ссылки и прямые ссылки на MP4/WebM. Клип будет идти без звука и синхронно с песней."
    )
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
  if (!normalizeText(form?.title)) return tr("Укажите название песни.");
  const tempo = normalizeNumber(form.tempo_override);
  if (tempo != null && tempo <= 0) return tr("Темп должен быть больше 0 BPM.");
  const [min, max] = [midi(form.note_range_min), midi(form.note_range_max)];
  return max != null && min > max ? tr("Нижняя нота диапазона не может быть выше верхней.") : null;
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
        await alert(tr("Не удалось сохранить: {0}", { 0: getErrorMessage(error) }));
      }
    });
  const content = query.error ? (
    <Stack gap={0.75}>
      <Typography role="alert" tone="danger">
        {tr("Не удалось загрузить песню:")} {getErrorMessage(query.error)}
      </Typography>
      <Button variant="outline" onClick={query.refresh}>
        {tr("Повторить")}
      </Button>
    </Stack>
  ) : !query.data ? (
    <Typography tone="muted">{tr("Загружаем настройки песни…")}</Typography>
  ) : !song ? (
    <Typography role="alert" tone="danger">
      {tr("Песня не найдена. Возможно, она была удалена.")}
    </Typography>
  ) : !form ? (
    <Typography tone="muted">{tr("Подготавливаем настройки…")}</Typography>
  ) : (
    <Stack gap={1}>
      <ConfigForm fields={SONG_FIELDS} context={{ form, onChange: update }} columns={12} />
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
      ariaLabel={tr("Настройки песни {0}", { 0: song?.title || "" }).trim()}
      titleProps={{
        icon: Music2,
        eyebrow: tr("КАРАОКЕ · РЕДАКТОР"),
        title: tr("Настройки песни"),
        description: song?.title || tr("Загружаем данные песни…"),
        actions: song && form && (
          <Button startIcon={<Save />} disabled={pending} onClick={save}>
            {tr(pending ? "Сохранение…" : "Сохранить")}
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
    <Typography sx={{ fontWeight: 800 }}>{tr("Мелодия и текст")}</Typography>
    <Typography variant="body2" tone="muted">
      {tr("Откройте piano-roll редактор, чтобы исправить ноты, длительность и привязку текста.")}
    </Typography>
    <Button variant="outline" startIcon={<Piano />} onClick={onClick}>
      {tr("Открыть редактор")}
    </Button>
  </Stack>
);
