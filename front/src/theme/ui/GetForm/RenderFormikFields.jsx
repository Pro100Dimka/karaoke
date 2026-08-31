import { translateSaved as tr } from "../../../i18n/runtime";
import { FormikContext, getIn, setIn } from "formik";
import { Suspense, useContext, useEffect, useId, useRef } from "react";
import Button from "../Button";
import FolderField from "../FolderField";
import Grid from "../Grid";
import NumberField from "../NumberField";
import RotaryKnob from "../RotaryKnob";
import Select from "../Select";
import Slider from "../Slider";
import Switch from "../Switch";
import TextField from "../TextField";
import Typography from "../Typography";
import decorateFormikRows from "./decorateFormikRows";
import "./get-form.css";

const aliases = {
  SimpleTextField: "text",
  TextField: "text",
  PasswordTextField: "password",
  NumberField: "number",
  SelectField: "select",
  Select: "select",
  SwitchField: "switch",
  Switch: "switch",
  CheckboxField: "switch",
  DateTextField: "date",
  DateAndTimePicker: "datetime-local",
  MobilePhone: "tel",
  FolderField: "folder",
  Slider: "slider",
  RotaryKnob: "knob",
  ButtonField: "button",
  Text: "label",
  Label: "label",
  Empty: "empty"
};
const controls = {
  number: NumberField,
  select: Select,
  switch: Switch,
  folder: FolderField,
  slider: Slider,
  knob: RotaryKnob
};
const textTypes = ["text", "password", "date", "datetime-local", "tel", "email", "url", "time"];
const breakpoints = ["xs", "sm", "md", "lg", "xl"];

function Field({ row, formik, components, onFieldCommit, pickFolder }) {
  const uid = useId().replace(/:/g, "");
  const {
    type = "SimpleTextField",
    tag,
    name = tag,
    formik: rowFormik,
    parse,
    onChange,
    onBlur,
    onCommit,
    inputType,
    fontWeight,
    children,
    defaultApiValue,
    selectedItems,
    render,
    fieldProps,
    onSave,
    saveOn,
    valueType,
    validate,
    ...rowProps
  } = row;
  const props = { ...rowProps, ...fieldProps };
  const state = rowFormik ?? formik;
  const kind = aliases[type] ?? type;
  const Component = components[type];
  const value = name ? getIn(state?.values, name) : undefined;
  const touched = name && (getIn(state?.touched, name) || state?.submitCount > 0);
  const error = props.error ?? (touched ? getIn(state?.errors, name) : undefined);
  const message = typeof error === "string" ? error : undefined;
  const revision = useRef(0);
  const current = useRef(value);
  current.current = value;
  const registerField = state?.registerField,
    unregisterField = state?.unregisterField;
  useEffect(() => {
    if (!name || !validate) return undefined;
    registerField?.(name, { validate });
    return () => unregisterField?.(name);
  }, [name, validate, registerField, unregisterField]);
  const mode =
    saveOn ?? (textTypes.includes(kind) || ["number", "folder"].includes(kind) ? "blur" : "change");
  const parseValue = (rawValue) =>
    parse
      ? parse(rawValue, state)
      : valueType === "nullable-number" && (rawValue === "" || rawValue == null)
        ? null
        : (kind === "number" || ["number", "nullable-number"].includes(valueType)) &&
            rawValue !== ""
          ? Number(rawValue)
          : rawValue;
  const persist = async (next) => {
    if (!name || (!onSave && !onFieldCommit) || props.disabled || props.readOnly || mode === false)
      return;
    const ticket = ++revision.current;
    try {
      state.setStatus(undefined);
      const errors = await state.validateForm(setIn(state.values, name, next));
      if (ticket !== revision.current || getIn(errors, name)) return;
      if (onSave) await onSave(next);
      else await onFieldCommit(name, next);
    } catch (error) {
      state.setStatus(error?.message ?? String(error));
    }
  };
  const change = (rawValue, event) => {
    const next = parseValue(rawValue);
    revision.current += 1;
    current.current = next;
    if (name) state?.setFieldValue(name, next);
    onChange?.(next, event);
    if (mode === "change") persist(next);
  };
  const blur = (event) => {
    if (name) state?.setFieldTouched(name, true);
    onBlur?.(event);
    if (mode === "blur") persist(current.current);
  };
  const bound = {
    ...props,
    id: props.id ?? `get-form-${uid}`,
    name,
    disabled: Boolean(state?.isSubmitting || props.disabled),
    value: value ?? "",
    error: message,
    onChange: change,
    onBlur: blur
  };

  if (Component || render) {
    const customProps = {
      ...bound,
      tag: name,
      formik: state,
      defaultApiValue,
      selectedItems,
      children
    };
    return Component ? <Component {...customProps} /> : render(customProps);
  }
  if (kind === "empty") return null;
  if (kind === "label") {
    const { text, label, ...labelProps } = props;
    return (
      <Typography {...labelProps} sx={{ fontWeight, ...props.sx }}>
        {children ?? text ?? label ?? value}
      </Typography>
    );
  }
  if (kind === "button") {
    const { label, ...buttonProps } = props;
    return (
      <Button {...buttonProps} disabled={bound.disabled} type={inputType ?? "button"}>
        {children ?? label}
      </Button>
    );
  }
  if (!state || !name) throw new Error(`GetForm: field "${type}" requires formik and tag/name.`);
  if (textTypes.includes(kind)) return <TextField fullWidth {...bound} type={inputType ?? kind} />;
  const Control = controls[kind];
  if (!Control) throw new Error(`GetForm: register components["${type}"] for this field type.`);
  if (kind === "switch") return <Control {...bound} value={undefined} checked={Boolean(value)} />;
  if (kind === "folder" && pickFolder && !props.onBrowse) {
    return (
      <Control
        fullWidth
        {...bound}
        onBrowse={async () => {
          try {
            const next = await pickFolder(current.current || undefined);
            if (!next) return;
            current.current = next;
            await state.setFieldValue(name, next, false);
            state.setFieldTouched(name, true, false);
            onChange?.(next);
            await persist(next);
          } catch (error) {
            state.setStatus(error?.message ?? String(error));
          }
        }}
      />
    );
  }
  if (kind === "knob") {
    // RotaryKnob has a value/commit API, not a native input blur/error API.
    return (
      <div onBlur={blur}>
        <Control
          {...props}
          value={value ?? 0}
          disabled={bound.disabled}
          onChange={change}
          onCommit={(next) => {
            // The knob changes and commits in the same event. Formik may not
            // have rendered the new value yet, so validate that value explicitly.
            state.setFieldTouched(name, true, false);
            if (state.validateOnBlur)
              state.validateForm(setIn(state.values, name, parseValue(next)));
            onCommit?.(next);
          }}
        />
        {message && (
          <small className="ui-field-message" data-error role="alert">
            {message}
          </small>
        )}
      </div>
    );
  }
  return <Control {...(kind !== "slider" && { fullWidth: true })} {...bound} />;
}

export default function RenderFormikFields({
  items = [],
  formik,
  components = {},
  onFieldCommit,
  pickFolder,
  showForProps,
  children,
  disableLast = true,
  spacing = 2,
  rowSpacing = 3,
  columnSpacing = spacing,
  gap = spacing * 8,
  rowGap = rowSpacing * 8,
  columnGap = columnSpacing * 8,
  ...props
}) {
  const context = useContext(FormikContext);
  const state = formik ?? context;
  const rows = items.map((row) => decorateFormikRows([row], { formik: row.formik ?? state })[0]);
  return (
    <Grid {...props} container gap={gap} rowGap={rowGap} columnGap={columnGap}>
      {rows.map(({ xs, sm, md, lg, xl, size, showFor, gSx, key, ...row }, index) => {
        if (
          showFor !== undefined &&
          !(typeof showFor === "function" ? showFor(showForProps ?? state?.values) : showFor)
        )
          return null;
        const sizes = {
          ...(size && typeof size === "object" ? size : { xs: size ?? 12 }),
          xs: xs ?? (size && typeof size === "object" ? size.xs : size) ?? 12
        };
        for (const [point, span] of Object.entries({ sm, md, lg, xl }))
          if (span !== undefined) sizes[point] = span;
        let visible = "flex";
        const visibility = Object.fromEntries(
          breakpoints.map((point) => {
            if (sizes[point] !== undefined) visible = sizes[point] === 0 ? "none" : "flex";
            return [`--get-form-display-${point}`, visible];
          })
        );
        return (
          <Grid
            item
            size={sizes}
            key={key ?? row.name ?? row.tag ?? index}
            className="ui-get-form-cell"
            sx={gSx}
            style={visibility}
          >
            <Suspense fallback={<span role="status">{tr("common.field.loading")}</span>}>
              <Field
                row={row}
                formik={state}
                components={components}
                onFieldCommit={onFieldCommit}
                pickFolder={pickFolder}
              />
            </Suspense>
          </Grid>
        );
      })}
      {!disableLast && items.length % 2 !== 0 && <Grid item xs={12} aria-hidden="true" />}
      {children}
    </Grid>
  );
}
