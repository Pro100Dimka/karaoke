export const getSelectedSong = (songs, songId) => {
  const list = Array.isArray(songs) ? songs.filter(Boolean) : [];
  return songId ? list.find((song) => song?.id === songId) : list[0];
};

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

export const normalizeText = (value) =>
  typeof value === "string" && value.trim() ? value.trim() : null;
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
