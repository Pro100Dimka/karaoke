export const HALF = 6;
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

  ...[
    ["tempo_override", "Темп", "number", { min: 1, parse: "nullable-number" }],
    ["key_override", "Тональность", "text", { placeholder: "напр. C#m" }],
    ["genre", "Жанр", "text", { placeholder: "Alternative rock" }]
  ].map(([name, label, type, extra]) =>
    formField(name, {
      type,
      label,
      span: THIRD,
      ...extra
    })
  ),

  formField("difficulty_override", {
    type: "select",
    label: "Сложность",
    options: DIFFICULTY_OPTIONS,
    span: HALF
  }),

  {
    type: "noteRange",
    name: "note_range",
    label: "Диапазон нот",
    tooltip: "Минимальная и максимальная MIDI-нота для этой песни",
    span: HALF,
    min: 0,
    max: 127,
    step: 1,
    minPlaceholder: "Мин.",
    maxPlaceholder: "Макс.",

    getValue: ({ form }) => ({
      min: form?.note_range_min ?? null,
      max: form?.note_range_max ?? null
    }),

    setValue: ({ onChange }, value) => {
      onChange("note_range_min", value?.min ?? null);
      onChange("note_range_max", value?.max ?? null);
    }
  },

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
  hint:
    "Каждая строка — отдельная строка песни. Тайминги сохраняются автоматически."
};
