import { translateSaved as tr } from "../../../../i18n/runtime";

export const normalizeText = (value) => (typeof value === "string" ? value.trim() || null : null);

export const number = (value) => {
  if (value === "" || value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
};

export const midi = (value) => {
  const n = number(value);
  return n == null ? null : Math.min(127, Math.max(0, Math.round(n)));
};
export const validateSongSettings = (form) => {
  if (!normalizeText(form?.title)) return tr("library.enterTheTitleOfTheSong");

  const tempo = number(form.tempo_override);
  if (tempo != null && tempo <= 0) return tr("library.theTempoMustBeGreaterThan0Bpm");

  const min = midi(form.note_range_min);
  const max = midi(form.note_range_max);

  return min != null && max != null && min > max
    ? tr("library.theBottomNoteOfTheRangeCannotBeHigher")
    : null;
};

const TEXT_FIELDS = ["artist", "genre", "key_override", "difficulty_override", "video_url"];

export const createSongPayload = (form, song) => ({
  title: normalizeText(form.title) || song.title,
  ...Object.fromEntries(TEXT_FIELDS.map((key) => [key, normalizeText(form[key])])),
  tempo_override: number(form.tempo_override),
  note_range_min: midi(form.note_range_min),
  note_range_max: midi(form.note_range_max)
});
