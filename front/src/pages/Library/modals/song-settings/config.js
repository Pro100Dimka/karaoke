export const HALF = 6;
export const QUARTER = 3;
export const THIRD = 4;
export const FULL = 12;

export const DIFFICULTY_OPTIONS = [
  { value: "", label: "Авто (по AI)" },

  ...["Лёгкий", "Средний", "Сложный", "Эксперт"].map((value) => ({
    value,
    label: value
  }))
];

const formField = (name, config = {}) => ({
  name,
  span: HALF,

  getValue: ({ form }) => form?.[name],

  setValue: ({ onChange }, value) => onChange(name, value),

  ...config
});

export const SONG_FIELDS = [
  /* Исполнитель + название */
  ...[
    ["artist", "Исполнитель", "Muse"],

    ["title", "Название песни", "Название песни"]
  ].map(([name, label, placeholder]) =>
    formField(name, {
      type: "text",
      label,
      placeholder,
      span: HALF
    })
  ),

  /* Темп + тональность + жанр */
  ...[
    [
      "tempo_override",
      "Темп",
      "number",
      {
        min: 1,
        parse: "nullable-number"
      }
    ],

    [
      "key_override",
      "Тональность",
      "text",
      {
        placeholder: "напр. C#m"
      }
    ],

    [
      "genre",
      "Жанр",
      "text",
      {
        placeholder: "Alternative rock"
      }
    ]
  ].map(([name, label, type, extra]) =>
    formField(name, {
      type,
      label,
      span: THIRD,
      ...extra
    })
  ),

  /* Сложность + диапазон нот */
  formField("difficulty_override", {
    type: "select",
    label: "Сложность",
    options: DIFFICULTY_OPTIONS,
    span: HALF
  }),

  formField("note_range_min", {
    type: "number",
    label: "Диапазон нот · от",
    min: 0,
    max: 127,
    parse: "nullable-number",
    span: QUARTER
  }),

  formField("note_range_max", {
    type: "number",
    label: "До",
    min: 0,
    max: 127,
    parse: "nullable-number",
    span: QUARTER
  }),

  /* Видео */
  formField("video_url", {
    type: "text",
    label: "Ссылка на клип",

    placeholder: "https://example.com/video.mp4",

    tooltip:
      "Поддерживаются YouTube-ссылки и прямые ссылки на MP4/WebM. Клип будет идти без звука и синхронно с песней.",

    span: FULL
  })
];

export const EMPTY_LYRICS = {
  text: "",
  data: [],
  error: null
};

export const LYRICS_FIELD = {
  name: "lyrics",
  label: "Текст песни",
  type: "textarea",

  rows: 16,
  spellCheck: false,

  className: "song-lyrics-editor",

  hint: "Каждая строка — отдельная строка песни. Тайминги сохраняются автоматически.",

  span: FULL
};
