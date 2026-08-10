export const HALF = 6;

export const radioActions = {
  stationId: "setStation",
  volume: "setVolume"
};

export const opts = (items) =>
  items.map(([value, label]) => ({ value, label }));

export const percent =
  (label) =>
  ({ value }) =>
    `${label} · ${Math.round((value ?? 0) * 100)}%`;

const createField =
  ({ get, set, save }) =>
  (name, config = {}) => ({
    name,
    span: HALF,
    getValue: get?.(name),
    setValue: set?.(name),
    saveValue: save?.(name),
    ...config
  });

export const fieldType =
  (factory, type) =>
  (name, config = {}) =>
    factory(name, { type, ...config });

const formField = createField({
  get:
    (name) =>
    ({ form }) =>
      form?.[name],

  set:
    (name) =>
    ({ onChange }, value) =>
      onChange(name, value),

  save:
    (name) =>
    ({ onFieldBlur }, value) =>
      onFieldBlur(name, value)
});

export const radioField = createField({
  get:
    (name) =>
    ({ radio }) =>
      radio?.[name],

  set:
    (name) =>
    ({ radio }, value) =>
      radio?.[radioActions[name]]?.(value)
});

const audioField = createField({
  get:
    (name) =>
    ({ audio }) =>
      audio.values?.[name],

  set:
    (name) =>
    ({ audio }, value) =>
      audio.updateBackend({ [name]: value })
});

const preferenceField = createField({
  get:
    (name) =>
    ({ audio }) =>
      audio.preferences?.[name],

  set:
    (name) =>
    ({ audio }, value) =>
      audio.updatePreference(name, value)
});

const formSelect = fieldType(formField, "select");
const formToggle = fieldType(formField, "toggle");
const formNumber = fieldType(formField, "number");
export const formReadonly = fieldType(formField, "readonly");

export const audioSlider = fieldType(audioField, "slider");

export const FORM_FIELDS = {
  select: formSelect,
  text: fieldType(formField, "text"),
  number: formNumber,
  toggle: formToggle,
  readonly: formReadonly
};

const audioOption =
  (name) =>
  ({ audio }) =>
    audio.options?.[name] ?? [];

const selectFrom =
  (factory) =>
  (name, source, config = {}) =>
    factory(name, {
      type: "select",
      ...(typeof source === "string"
        ? { getOptions: audioOption(source) }
        : { options: source }),
      ...config
    });

export const audioSelect = selectFrom(audioField);
export const preferenceSelect = selectFrom(preferenceField);

export const monitorDisabled = ({ audio }) =>
  Boolean(audio.states?.monitoringEnabled);

export const audioDriverVisible = ({ audio }) =>
  audio.values?.audio_driver === "asio";

export const speakerPlaying = ({ audio }) =>
  audio.states?.speakerTestState === "playing";
