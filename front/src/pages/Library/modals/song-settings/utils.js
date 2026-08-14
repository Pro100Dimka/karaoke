import { translateSaved } from "../../../../i18n/runtime";

export function getSelectedSong(songs, songId) {
  const list = Array.isArray(songs) ? songs.filter(Boolean) : [];
  return songId ? list.find((song) => song.id === songId) : list[0];
}
export function normalizeText(value) {
  if (typeof value !== "string") return null;
  return value.trim() || null;
}
function normalizeNullableNumber(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function normalizeMidiNote(value) {
  const number = normalizeNullableNumber(value);
  if (number == null) return null;
  return Math.max(0, Math.min(127, Math.round(number)));
}
export function validateSongSettings(form) {
  const title = normalizeText(form?.title);
  if (!title) return translateSaved("Укажите название песни.");
  const tempo = normalizeNullableNumber(form.tempo_override);
  if (tempo != null && tempo <= 0) {
    return translateSaved("Темп должен быть больше 0 BPM.");
  }
  const minNote = normalizeMidiNote(form.note_range_min);
  const maxNote = normalizeMidiNote(form.note_range_max);
  if (maxNote != null && minNote > maxNote) {
    return translateSaved("Нижняя нота диапазона не может быть выше верхней.");
  }
  return null;
}
export function createSongPayload(form, song) {
  return {
    title: normalizeText(form.title) ?? song.title,
    artist: normalizeText(form.artist),
    genre: normalizeText(form.genre),
    key_override: normalizeText(form.key_override),
    tempo_override: normalizeNullableNumber(form.tempo_override),
    note_range_min: normalizeMidiNote(form.note_range_min),
    note_range_max: normalizeMidiNote(form.note_range_max),
    difficulty_override: normalizeText(form.difficulty_override),
    video_url: normalizeText(form.video_url)
  };
}
