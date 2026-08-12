import { NumberField, Stack } from "../../../../theme/ui";
import Field from "../../../../theme/ui/_internal/Field";

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

  {
    type: "custom",
    name: "note_range",
    label: "Диапазон нот",
    span: HALF,
    render: ({ context }) => (
      <Field label="Диапазон нот">
        {({ id }) => (
          <Stack direction="row" gap={1} sx={{ width: "100%" }}>
            <NumberField
              id={`${id}-min`}
              value={context.form?.note_range_min ?? ""}
              min={0}
              max={127}
              placeholder="От"
              aria-label="Нижняя нота"
              onChange={(value) =>
                context.onChange(
                  "note_range_min",
                  value === "" ? null : Number(value)
                )
              }
            />
            <NumberField
              id={`${id}-max`}
              value={context.form?.note_range_max ?? ""}
              min={0}
              max={127}
              placeholder="До"
              aria-label="Верхняя нота"
              onChange={(value) =>
                context.onChange(
                  "note_range_max",
                  value === "" ? null : Number(value)
                )
              }
            />
          </Stack>
        )}
      </Field>
    )
  },

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
