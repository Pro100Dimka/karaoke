/* @vitest-environment jsdom */
import { cleanup, fireEvent, render } from "@testing-library/react";
import { beforeEach, expect, test, vi } from "vitest";
import { same, verify } from "./helpers/assertions.mjs";
vi.mock("../src/theme/ui", () => ({
  Stack: ({ children, sx, ...props }) => (
    <div data-width={sx?.width} {...props}>
      {children}
    </div>
  ),
  NumberField: ({ onChange, ...props }) => <input {...props} onChange={(event) => onChange(event.target.value)} />
}));
vi.mock("../src/theme/ui/_internal/Field", () => ({
  default: ({ children, label }) => <section aria-label={label}>{children({ id: "range" })}</section>
}));
vi.mock("../src/i18n/runtime", () => ({ translateSaved: (value) => value }));
let schema;
beforeEach(async () => {
  vi.resetModules();
  schema = await import("../src/pages/Library/song-settings.jsx");
});
test("song settings schema describes every persisted field exactly", () => {
  const { DIFFICULTY_OPTIONS, FULL, HALF, SONG_FIELDS, THIRD } = schema;
  expect([HALF, THIRD, FULL]).toEqual([6, 4, 12]);
  verify([
    DIFFICULTY_OPTIONS,
    "toEqual",
    [
      { value: "", label: "Авто (по AI)" },
      { value: "Лёгкий", label: "Лёгкий" },
      { value: "Средний", label: "Средний" },
      { value: "Сложный", label: "Сложный" },
      { value: "Эксперт", label: "Эксперт" }
    ]
  ]);
  expect(SONG_FIELDS.map(({ getValue, setValue, render, ...field }) => field)).toEqual([
    { name: "artist", span: 6, type: "text", label: "Исполнитель", placeholder: "Muse" },
    {
      name: "title",
      span: 6,
      type: "text",
      label: "Название песни",
      placeholder: "Название песни",
      required: true
    },
    {
      name: "tempo_override",
      span: 4,
      type: "number",
      label: "Темп",
      min: 1,
      parse: "nullable-number"
    },
    { name: "key_override", span: 4, type: "text", label: "Тональность", placeholder: "напр. C#m" },
    {
      name: "genre",
      span: 4,
      type: "select",
      label: "Жанр",
      options: SONG_FIELDS.find(({ name }) => name === "genre").options
    },
    {
      name: "difficulty_override",
      span: 6,
      type: "select",
      label: "Сложность",
      options: DIFFICULTY_OPTIONS
    },
    { type: "custom", name: "note_range", label: "Диапазон нот", span: 6 },
    {
      name: "video_url",
      span: 12,
      type: "text",
      label: "Ссылка на клип",
      placeholder: "https://example.com/video.mp4",
      tooltip: "Поддерживаются YouTube-ссылки и прямые ссылки на MP4/WebM. Клип будет идти без звука и синхронно с песней."
    }
  ]);
  const change = vi.fn();
  for (const field of SONG_FIELDS.filter(({ getValue }) => getValue)) {
    verify([field.getValue({ form: { [field.name]: "saved" } }), "toBe", "saved"], [field.getValue({ form: null }), "toBeUndefined"]);
    field.setValue({ onChange: change }, "next");
    expect(change).toHaveBeenLastCalledWith(field.name, "next");
  }
});
test("note range renderer preserves its accessible contract and normalizes values", () => {
  const range = schema.SONG_FIELDS.find(({ name }) => name === "note_range");
  const change = vi.fn();
  const { container, getByLabelText } = render(
    range.render({
      context: { form: { note_range_min: 40, note_range_max: 80 }, onChange: change }
    })
  );
  verify([getByLabelText("Диапазон нот").getAttribute("aria-label"), "toBe", "Диапазон нот"]);
  const [minimum, maximum] = container.querySelectorAll("input");
  verify([minimum, "toMatchObject", { id: "range-min", value: "40", min: "0", max: "127", placeholder: "От" }]);
  expect(minimum.getAttribute("aria-label")).toBe("Нижняя нота");
  verify([maximum, "toMatchObject", { id: "range-max", value: "80", min: "0", max: "127", placeholder: "До" }]);
  same(
    [maximum.getAttribute("aria-label"), "Верхняя нота"],
    [minimum.parentElement.getAttribute("direction"), "row"],
    [minimum.parentElement.getAttribute("gap"), "1"],
    [minimum.parentElement.getAttribute("data-width"), "100%"]
  );
  fireEvent.change(minimum, { target: { value: "" } });
  fireEvent.change(maximum, { target: { value: "90" } });
  fireEvent.change(minimum, { target: { value: "41" } });
  fireEvent.change(maximum, { target: { value: "" } });
  verify([
    change.mock.calls,
    "toEqual",
    [
      ["note_range_min", null],
      ["note_range_max", 90],
      ["note_range_min", 41],
      ["note_range_max", null]
    ]
  ]);
  cleanup();
  const empty = render(range.render({ context: { form: null, onChange: change } }));
  verify([[...empty.container.querySelectorAll("input")].map(({ value }) => value), "toEqual", ["", ""]]);
});
