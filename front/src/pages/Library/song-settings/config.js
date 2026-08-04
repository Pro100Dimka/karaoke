export const DIFFICULTY_OPTIONS = [
  { value: "", label: "Авто (по AI)" },
  ...["Лёгкий", "Средний", "Сложный", "Эксперт"].map((value) => ({
    value,
    label: value
  }))
];

export const SONG_FIELDS = [
  { name: "key_override", label: "Тональность", placeholder: "напр. C#m" },
  { name: "title", label: "Название песни", type: "text" },
  { name: "artist", label: "Группа / исполнитель", placeholder: "Muse" },
  { name: "genre", label: "Жанр", placeholder: "Alternative rock" },
  { name: "tempo_override", label: "Темп (BPM)", type: "number", min: 1 },
  {
    name: "difficulty_override",
    label: "Уровень сложности",
    type: "select",
    options: DIFFICULTY_OPTIONS
  },
  {
    name: "video_url",
    label: "Ссылка на клип",
    type: "url",
    placeholder: "https://example.com/video.mp4",
    hint: "Поддерживаются YouTube-ссылки и прямые ссылки на MP4/WebM. Клип будет идти без звука и синхронно с песней."
  },
  { name: "show_lyrics", label: "Показывать текст", type: "toggle" },
  { name: "show_notes", label: "Показывать ноты", type: "toggle" }
];

export const NOTE_RANGE_FIELDS = [
  {
    name: "note_range_min",
    type: "number",
    placeholder: "min",
    className: "note-range-input"
  },
  {
    name: "note_range_max",
    type: "number",
    placeholder: "max",
    className: "note-range-input"
  }
];

export const EMPTY_LYRICS = { text: "", data: [], error: null };
