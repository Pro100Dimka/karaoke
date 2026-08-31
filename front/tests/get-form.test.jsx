/* @vitest-environment jsdom */
import { act, cleanup, fireEvent, render, renderHook, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, test, vi } from "vitest";
import GetForm, {
  useGetForm,
  RenderFormikFields,
  decorateFormikRows,
  appendData,
  getDataByFields,
  mergeProperties,
  mergePropertiesWithNull,
  SetFormikForApiField
} from "../src/theme/ui/GetForm";

afterEach(cleanup);

function AutoSaveForm({ items, initialValues, validate, ...props }) {
  const formik = useGetForm({ initialValues, validate });
  return (
    <GetForm formik={formik} items={items} {...props}>
      <output data-testid="values">{JSON.stringify(formik.values)}</output>
      {formik.status && <p role="alert">{formik.status}</p>}
    </GetForm>
  );
}

test("ordinary rows save arbitrary nested names through a single form callback", async () => {
  const commit = vi.fn();
  render(
    <AutoSaveForm
      initialValues={{ profile: { nickname: "old", limit: 3 } }}
      onFieldCommit={commit}
      items={[
        { tag: "profile.nickname", label: "Nickname" },
        {
          tag: "profile.limit",
          type: "NumberField",
          label: "Limit",
          validate: (value) => (Number.isInteger(value) && value > 0 ? undefined : "Positive integer required")
        }
      ]}
    />
  );
  fireEvent.change(screen.getByLabelText("Nickname"), { target: { value: "new" } });
  expect(commit).not.toHaveBeenCalled();
  fireEvent.blur(screen.getByLabelText("Nickname"));
  await waitFor(() => expect(commit).toHaveBeenCalledWith("profile.nickname", "new"));
  commit.mockClear();
  fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "0" } });
  fireEvent.blur(screen.getByLabelText("Limit"));
  expect(await screen.findByText("Positive integer required")).toBeTruthy();
  expect(commit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Limit"), { target: { value: "7" } });
  fireEvent.blur(screen.getByLabelText("Limit"));
  await waitFor(() => expect(commit).toHaveBeenCalledWith("profile.limit", 7));
});

test("custom save replaces the form callback, while saveOn false keeps a field local", async () => {
  const commit = vi.fn(),
    custom = vi.fn();
  render(
    <AutoSaveForm
      initialValues={{ enabled: false, local: false, gain: 0 }}
      onFieldCommit={commit}
      items={[
        { tag: "enabled", label: "Custom", type: "SwitchField", onSave: custom },
        { tag: "local", label: "Local", type: "SwitchField", saveOn: false },
        { tag: "gain", label: "Gain", type: "Slider", min: 0, max: 1, step: 0.1 }
      ]}
    />
  );
  fireEvent.click(screen.getByRole("switch", { name: "Custom" }));
  await waitFor(() => expect(custom).toHaveBeenCalledWith(true));
  fireEvent.click(screen.getByRole("switch", { name: "Local" }));
  await act(async () => {});
  expect(commit).not.toHaveBeenCalled();
  expect(JSON.parse(screen.getByTestId("values").textContent).local).toBe(true);
  fireEvent.change(screen.getByRole("slider"), { target: { value: "0.4" } });
  fireEvent.change(screen.getByRole("slider"), { target: { value: "0.9" } });
  await waitFor(() => expect(commit).toHaveBeenCalledOnce());
  expect(commit).toHaveBeenCalledWith("gain", 0.9);
});

test("late validation cannot save a stale value after another edit", async () => {
  const commit = vi.fn(),
    pending = [];
  render(
    <AutoSaveForm
      initialValues={{ draft: "" }}
      onFieldCommit={commit}
      validate={() => new Promise((resolve) => pending.push(resolve))}
      items={[{ tag: "draft", label: "Draft", saveOn: "change" }]}
    />
  );
  fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "first" } });
  await waitFor(() => expect(pending).toHaveLength(1));
  fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "second" } });
  await waitFor(() => expect(pending).toHaveLength(2));
  await act(async () => pending[1]({}));
  expect(commit).toHaveBeenCalledWith("draft", "second");
  await act(async () => pending[0]({}));
  expect(commit).toHaveBeenCalledOnce();
});

test("save failures reach Formik status and a successful retry clears the error", async () => {
  const commit = vi.fn().mockRejectedValueOnce(new Error("Cannot save")).mockResolvedValue(undefined);
  render(<AutoSaveForm initialValues={{ draft: "" }} onFieldCommit={commit} items={[{ tag: "draft", label: "Draft" }]} />);
  fireEvent.change(screen.getByLabelText("Draft"), { target: { value: "new" } });
  fireEvent.blur(screen.getByLabelText("Draft"));
  expect(await screen.findByRole("alert")).toHaveProperty("textContent", "Cannot save");
  fireEvent.blur(screen.getByLabelText("Draft"));
  await waitFor(() => expect(commit).toHaveBeenCalledTimes(2));
  expect(screen.queryByRole("alert")).toBeNull();
});

function Demo({ onSubmit = async () => {}, initialValues = { title: "", amount: 0, enabled: false, mode: "a" }, ...props }) {
  const formik = useGetForm({ initialValues, onSubmit, validate: (values) => (values.title ? {} : { title: "Введите название" }) });
  return (
    <GetForm
      formik={formik}
      items={[
        { tag: "title", label: "Название", type: "SimpleTextField", xs: 12, md: 8 },
        { tag: "amount", label: "Количество", type: "NumberField", xs: 12, md: 4 },
        { tag: "enabled", label: "Активно", type: "SwitchField" },
        {
          tag: "mode",
          label: "Режим",
          type: "SelectField",
          options: [
            { value: "a", label: "Первый" },
            { value: "b", label: "Второй" }
          ]
        },
        { type: "ButtonField", label: "Сохранить", inputType: "submit" }
      ]}
      {...props}
    >
      <output data-testid="values">{JSON.stringify(formik.values)}</output>
    </GetForm>
  );
}

test("real theme fields bind values, validate on blur and submit numbers/booleans", async () => {
  const submit = vi.fn(async () => {});
  const user = userEvent.setup();
  render(<Demo onSubmit={submit} />);
  const title = screen.getByLabelText("Название");
  const id = title.id;
  await user.click(title);
  await user.tab();
  expect(await screen.findByText("Введите название")).toBeTruthy();
  await user.type(title, "Ария");
  expect(title.id).toBe(id);
  await user.clear(screen.getByLabelText("Количество"));
  await user.type(screen.getByLabelText("Количество"), "12");
  await user.click(screen.getByRole("switch"));
  await user.click(screen.getByRole("button", { name: "Сохранить" }));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(submit.mock.calls[0][0]).toEqual({ title: "Ария", amount: 12, enabled: true, mode: "a" });
  expect(screen.queryByText("Введите название")).toBeNull();
});

test("invalid submit is blocked; inputs and submit are disabled only during async submission", async () => {
  let complete;
  const submit = vi.fn(
    () =>
      new Promise((resolve) => {
        complete = resolve;
      })
  );
  render(<Demo onSubmit={submit} />);
  fireEvent.click(screen.getByText("Сохранить"));
  await screen.findByText("Введите название");
  expect(submit).not.toHaveBeenCalled();
  fireEvent.change(screen.getByLabelText("Название"), { target: { value: "Трек" } });
  fireEvent.click(screen.getByText("Сохранить"));
  await waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
  expect(screen.getByLabelText("Название").disabled).toBe(true);
  expect(screen.getByText("Сохранить").disabled).toBe(true);
  await act(async () => complete());
  expect(screen.getByText("Сохранить").disabled).toBe(false);
});

test("theme Select writes selected value", async () => {
  render(<Demo />);
  const user = userEvent.setup();
  await user.click(screen.getByRole("button", { name: "Режим" }));
  await user.click(screen.getByRole("option", { name: "Второй" }));
  expect(JSON.parse(screen.getByTestId("values").textContent).mode).toBe("b");
});

test("reinitialization loads new data and reset restores it", async () => {
  const { result, rerender } = renderHook(({ initialValues }) => useGetForm({ initialValues, onSubmit: async () => {} }), {
    initialProps: { initialValues: { title: "one" } }
  });
  await act(async () => result.current.setFieldValue("title", "edit"));
  rerender({ initialValues: { title: "two" } });
  await waitFor(() => expect(result.current.values.title).toBe("two"));
  await act(async () => result.current.setFieldValue("title", "edit again"));
  await act(async () => result.current.resetForm());
  expect(result.current.values.title).toBe("two");
});

test("positional hook accepts the archive's initialValues/schema/submit signature", async () => {
  const submit = vi.fn(async () => {});
  const { result } = renderHook(() => useGetForm({ value: false }, undefined, submit));
  await act(async () => result.current.submitForm());
  expect(submit.mock.calls[0][0]).toEqual({ value: false });
});

test("nested fields, custom parsing, independent grid sizes and conditional visibility", async () => {
  function Nested() {
    const formik = useGetForm({ initialValues: { person: { name: "" } }, onSubmit: async () => {} });
    return (
      <GetForm
        formik={formik}
        showForProps={{ visible: false }}
        items={[
          { tag: "person.name", label: "Имя", xs: 12, md: 5, parse: (value) => value.toUpperCase() },
          { type: "Label", text: "Скрыто", showFor: (props) => props.visible },
          { type: "Empty", xs: 0, sm: 3, md: 0, lg: 7 }
        ]}
      >
        <output>{formik.values.person.name}</output>
      </GetForm>
    );
  }
  const { container } = render(<Nested />);
  fireEvent.change(screen.getByLabelText("Имя"), { target: { value: "hello" } });
  await waitFor(() => expect(screen.getByLabelText("Имя").value).toBe("HELLO"));
  expect(screen.queryByText("Скрыто")).toBeNull();
  const cells = container.querySelectorAll(".ui-get-form-cell");
  expect(cells.length).toBe(2);
  expect(cells[0].style.getPropertyValue("--grid-item-column-md")).toBe("span 5");
  expect(cells[1].style.getPropertyValue("--get-form-display-xs")).toBe("none");
  expect(cells[1].style.getPropertyValue("--get-form-display-sm")).toBe("flex");
  expect(cells[1].style.getPropertyValue("--get-form-display-md")).toBe("none");
  expect(cells[1].style.getPropertyValue("--get-form-display-xl")).toBe("flex");
});

test("custom API components receive selection callback and Formik without duplicate DOM props", async () => {
  function ApiField({ selectedItems, defaultApiValue, disabled }) {
    return (
      <button type="button" disabled={disabled} onClick={() => selectedItems({ id: 0, title: "New" })}>
        {defaultApiValue.title}
      </button>
    );
  }
  function ApiForm() {
    const formik = useGetForm({ initialValues: { orgId: 2, org: { id: 2, title: "Old" } }, onSubmit: async () => {} });
    return (
      <GetForm
        formik={formik}
        components={{ AutocompleteApi: ApiField }}
        items={[{ type: "AutocompleteApi", tag: "orgId", lookUpTag: "org", filter_field: "id" }]}
      >
        <output data-testid="api-values">{JSON.stringify(formik.values)}</output>
      </GetForm>
    );
  }
  render(<ApiForm />);
  fireEvent.click(screen.getByText("Old"));
  await waitFor(() => expect(JSON.parse(screen.getByTestId("api-values").textContent)).toEqual({ orgId: 0, org: { id: 0, title: "New" } }));
});

test("standalone renderer accepts decorated rows and per-row Formik", async () => {
  function Standalone() {
    const formik = useGetForm({ initialValues: { value: "hello" }, onSubmit: async () => {} });
    return <RenderFormikFields items={decorateFormikRows([{ tag: "value", label: "Standalone" }], { formik })} />;
  }
  render(<Standalone />);
  fireEvent.change(screen.getByLabelText("Standalone"), { target: { value: "edited" } });
  await waitFor(() => expect(screen.getByLabelText("Standalone").value).toBe("edited"));
});

test("row decoration preserves explicit disable and custom API selection", () => {
  const handler = vi.fn();
  const formik = { values: { org: { id: 3 } }, isSubmitting: false };
  const rows = decorateFormikRows(
    [
      { type: "Text", disabled: true },
      { lg: 12 },
      { type: "AutocompleteApi", tag: "orgId", lookUpTag: "org", defaultApiValueRender: { id: 1 }, handleChange: handler }
    ],
    { formik }
  );
  expect(rows[0]).toMatchObject({ fontWeight: 500, disabled: true, formik });
  expect(rows[1]).toMatchObject({ lg: 12, formik });
  expect(rows[2].defaultApiValue).toEqual({ id: 1 });
  rows[2].selectedItems({ id: 9 });
  expect(handler).toHaveBeenCalledWith({ id: 9 });
});

test("API helper preserves false and updates nested lookup without mutating input", async () => {
  const values = { ids: { selected: true }, record: { id: true, name: "Old" }, untouched: 42 };
  let updated;
  const formik = {
    setValues: vi.fn(async (update) => {
      updated = update(values);
    })
  };
  await SetFormikForApiField(formik, { id: false, name: "" }, "ids.selected", "id", "record");
  expect(updated).toEqual({ ids: { selected: false }, record: { id: false, name: "" }, untouched: 42 });
  expect(values.record.name).toBe("Old");
  await SetFormikForApiField(formik, null, "ids.selected", "id", "record");
  expect(updated.record).toEqual({ id: null, name: null });
  expect(updated.ids.selected).toBeNull();
  expect(() => SetFormikForApiField(formik, 1, "__proto__.polluted")).toThrow("unsafe");
  expect({}.polluted).toBeUndefined();
});

test("shape merging whitelists nested arrays but does not lose false, zero, empty or null", () => {
  const defaults = { count: 0, enabled: true, title: "Default", absent: 5, nil: "x", list: [{ id: 0, name: "" }] };
  const source = { count: 7, enabled: false, title: "", nil: null, extra: 1, list: [{ id: 0, name: "", extra: 2 }] };
  expect(mergeProperties(defaults, source)).toEqual({
    count: 7,
    enabled: false,
    title: "",
    absent: null,
    nil: null,
    list: [{ id: 0, name: "" }]
  });
  expect(mergePropertiesWithNull(defaults, source).absent).toBe(5);
  expect(mergePropertiesWithNull(defaults, source).count).toBe(7);
  expect(mergeProperties(defaults, null)).toEqual(defaults);
});

test("FormData handles files, repeated file arrays, JSON objects and falsy values", () => {
  const file = new File(["hello"], "hello.txt", { type: "text/plain" });
  const data = appendData({ file, files: [file], count: 0, enabled: false, empty: null, ids: [1, 2], record: { id: 3 } });
  expect(data.get("file")).toBe(file);
  expect(data.getAll("files")).toEqual([file]);
  expect(data.get("files_JSON")).toBe("{}");
  expect(data.get("count")).toBe("0");
  expect(data.get("enabled")).toBe("false");
  expect(data.get("empty")).toBe("");
  expect(data.get("ids")).toBe("[1,2]");
  expect(data.get("record")).toBe('{"id":3}');
});

test("field path list follows nested object/array schema and handles empty values", () => {
  expect(getDataByFields({ id: 0, name: "song", org: { id: 1 }, files: [{ id: 1, name: "x" }], empty: [], nil: null })).toBe(
    "id,name,org.id,files.id,files.name,empty,nil"
  );
  expect(getDataByFields(null)).toBe("");
});

test("knob commits validate its new value rather than the previous render's value", async () => {
  function KnobForm() {
    const formik = useGetForm({
      initialValues: { volume: 0, mix: 0 },
      validate: (values) => (values.volume < 0.5 ? { volume: "Слишком тихо" } : {}),
      onSubmit: async () => {}
    });
    return (
      <GetForm
        formik={formik}
        items={[
          { tag: "volume", type: "RotaryKnob", label: "Громкость", min: 0, max: 1 },
          { tag: "mix", type: "Slider", label: "Микс", min: 0, max: 1, step: 0.1 }
        ]}
      >
        <output data-testid="knob-state">
          {JSON.stringify({ values: formik.values, touched: formik.touched, errors: formik.errors })}
        </output>
      </GetForm>
    );
  }
  render(<KnobForm />);
  fireEvent.change(screen.getByRole("slider", { name: "Громкость" }), { target: { value: "0.8" } });
  await waitFor(() =>
    expect(JSON.parse(screen.getByTestId("knob-state").textContent)).toEqual({
      values: { volume: 0.8, mix: 0 },
      touched: { volume: true },
      errors: {}
    })
  );
  fireEvent.change(screen.getByRole("slider", { name: "Микс" }), { target: { value: "0.4" } });
  await waitFor(() => expect(JSON.parse(screen.getByTestId("knob-state").textContent).values.mix).toBe(0.4));
});

test("decorating API rows twice does not replace their lookup value or selection handler", () => {
  const handleChange = vi.fn();
  const formik = { values: { org: { id: 2 } } };
  const first = decorateFormikRows([{ type: "AutocompleteApi", tag: "orgId", lookUpTag: "org", handleChange }], { formik });
  const second = decorateFormikRows(first, { formik });
  expect(second[0].defaultApiValue).toEqual({ id: 2 });
  second[0].selectedItems({ id: 4 });
  expect(handleChange).toHaveBeenCalledWith({ id: 4 });
});

test("supports Yup-compatible validationSchema supplied to the hook", async () => {
  const schema = {
    validate: vi.fn(async () => {
      throw { name: "ValidationError", inner: [{ path: "title", message: "Ошибка схемы" }] };
    })
  };
  const submit = vi.fn(async () => {});
  const { result } = renderHook(() => useGetForm({ title: "" }, schema, submit));
  await act(async () => result.current.submitForm());
  expect(result.current.errors).toEqual({ title: "Ошибка схемы" });
  expect(submit).not.toHaveBeenCalled();
});
