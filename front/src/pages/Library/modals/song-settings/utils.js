export const getSelectedSong = (songs, songId) => {
  const list = Array.isArray(songs) ? songs.filter(Boolean) : [];
  return songId ? list.find((song) => song?.id === songId) : list[0];
};

export const normalizeText = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;

const normalizeNullableNumber = (value) => {
  if (value === "" || value == null) return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
};

const normalizeMidiNote = (value) => {
  const number = normalizeNullableNumber(value);
  if (number == null) return null;
  return Math.max(0, Math.min(127, Math.round(number)));
};

export function validateSongSettings(form) {
  const title = normalizeText(form?.title);
  if (!title) return "Укажите название песни.";

  const tempo = normalizeNullableNumber(form?.tempo_override);
  if (tempo != null && tempo <= 0) {
    return "Темп должен быть больше 0 BPM.";
  }

  const minNote = normalizeMidiNote(form?.note_range_min);
  const maxNote = normalizeMidiNote(form?.note_range_max);
  if (minNote != null && maxNote != null && minNote > maxNote) {
    return "Нижняя нота диапазона не может быть выше верхней.";
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

export const parseLyricsText = (text = "") =>
  String(text ?? "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

export const lyricsToText = (lines = []) =>
  (Array.isArray(lines) ? lines : [])
    .filter((line) => line && typeof line === "object")
    .map(({ text }) => text ?? "")
    .join("\n");

export const buildLyricsData = (lines, textLines) => {
  const sourceLines = Array.isArray(lines) ? lines : [];
  const replacementLines = Array.isArray(textLines) ? textLines : [];
  return sourceLines
    .filter((line) => line && typeof line === "object")
    .map((line, index) => ({
      ...line,
      text: replacementLines[index] ?? line.text
    }));
};
