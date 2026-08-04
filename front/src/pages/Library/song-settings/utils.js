export const getSelectedSong = (songs, songId) =>
  songId ? (songs ?? []).find(({ id }) => id === songId) : songs?.[0];

export function createSongPayload(form, song) {
  return {
    title: normalizeText(form.title) ?? song.title,
    artist: normalizeText(form.artist),
    genre: normalizeText(form.genre),
    key_override: normalizeText(form.key_override),
    tempo_override: form.tempo_override,
    note_range_min: form.note_range_min,
    note_range_max: form.note_range_max,
    difficulty_override: normalizeText(form.difficulty_override),
    video_url: normalizeText(form.video_url),
    show_lyrics: Boolean(form.show_lyrics),
    show_notes: Boolean(form.show_notes)
  };
}

export const normalizeText = (value) => value?.trim() ?? null;
export const parseLyricsText = (text = "") =>
  text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
export const lyricsToText = (lines = []) =>
  lines.map(({ text }) => text ?? "").join("\n");

export const buildLyricsData = (lines, textLines) =>
  lines.map((line, index) => ({
    ...line,
    text: textLines[index] ?? line.text
  }));
