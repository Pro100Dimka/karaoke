import { translateSaved } from "../../../../i18n/runtime";
import { NumberField, Stack } from "../../../../theme/ui";
import Field from "../../../../theme/ui/_internal/Field";

export const HALF = 6;
export const THIRD = 4;
export const FULL = 12;
export const DIFFICULTY_OPTIONS = [
  { value: "", label: translateSaved("Авто (по AI)") },
  ...[
    translateSaved("Лёгкий"),
    translateSaved("Средний"),
    translateSaved("Сложный"),
    translateSaved("Эксперт")
  ].map((value) => ({ value, label: value }))
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
    ["artist", translateSaved("Исполнитель"), "Muse"],
    ["title", translateSaved("Название песни"), translateSaved("Название песни")]
  ].map(([name, label, placeholder]) =>
    formField(name, { type: "text", label, placeholder, span: HALF })
  ),
  ...[
    ["tempo_override", translateSaved("Темп"), "number", { min: 1, parse: "nullable-number" }],
    [
      "key_override",
      translateSaved("Тональность"),
      "text",
      { placeholder: translateSaved("напр. C#m") }
    ],
    ["genre", translateSaved("Жанр"), "text", { placeholder: "Alternative rock" }]
  ].map(([name, label, type, extra]) => formField(name, { type, label, span: THIRD, ...extra })),
  formField("difficulty_override", {
    type: "select",
    label: translateSaved("Сложность"),
    options: DIFFICULTY_OPTIONS,
    span: HALF
  }),
  {
    type: "custom",
    name: "note_range",
    label: translateSaved("Диапазон нот"),
    span: HALF,
    render: ({ context }) => (
      <Field label={translateSaved("Диапазон нот")}>
        {({ id }) => (
          <Stack direction="row" gap={1} sx={{ width: "100%" }}>
            <NumberField
              id={`${id}-min`}
              value={context.form?.note_range_min ?? ""}
              min={0}
              max={127}
              placeholder={translateSaved("От")}
              aria-label={translateSaved("Нижняя нота")}
              onChange={(value) =>
                context.onChange("note_range_min", value === "" ? null : Number(value))
              }
            />
            <NumberField
              id={`${id}-max`}
              value={context.form?.note_range_max ?? ""}
              min={0}
              max={127}
              placeholder={translateSaved("До")}
              aria-label={translateSaved("Верхняя нота")}
              onChange={(value) =>
                context.onChange("note_range_max", value === "" ? null : Number(value))
              }
            />
          </Stack>
        )}
      </Field>
    )
  },
  formField("video_url", {
    type: "text",
    label: translateSaved("Ссылка на клип"),
    placeholder: "https://example.com/video.mp4",
    tooltip: translateSaved(
      "Поддерживаются YouTube-ссылки и прямые ссылки на MP4/WebM. Клип будет идти без звука и синхронно с песней."
    ),
    span: FULL
  })
];
