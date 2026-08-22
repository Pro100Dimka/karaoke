import { useId } from "react";
import NumberField from "../NumberField";
import Select from "../Select";
import Switch from "../Switch";
import TextField from "../TextField";
import Field from "../_internal/Field";

const identity = () => {};
const toNumber = (value) => (value === "" ? null : Number(value));

export default function FieldInput({
  id,
  field,
  value,
  onChange,
  onBlur = identity,
  onKeyDown,
  bare = false
}) {
  const generatedId = useId().replace(/:/g, "");
  const inputId = id ?? `field-${field.name}-${generatedId}`;
  const type = field.type ?? "text";
  const shared = {
    id: inputId,
    label: bare ? undefined : field.label,
    hint: bare ? undefined : field.hint,
    error: bare ? undefined : field.error,
    required: field.required,
    disabled: field.disabled,
    size: field.size ?? "md",
    fieldClassName: field.wrapperClassName,
    className: field.className,
    onKeyDown
  };

  if (type === "select") {
    return (
      <Select
        {...shared}
        value={value ?? ""}
        options={field.options ?? []}
        placeholder={field.placeholder}
        onChange={onChange}
        onBlur={() => onBlur(value)}
      />
    );
  }
  if (type === "toggle") {
    const control = (
      <Switch
        id={inputId}
        checked={Boolean(value)}
        disabled={field.disabled}
        variant={bare ? "plain" : "outlined"}
        label={bare ? field.label : undefined}
        onChange={(nextValue) => onChange(nextValue)}
        onBlur={(event) => onBlur(event.target.checked)}
      />
    );
    if (bare) return control;
    return (
      <Field
        id={inputId}
        label={field.label}
        hint={field.hint}
        error={field.error}
        disabled={field.disabled}
        className={field.wrapperClassName}
      >
        {() => control}
      </Field>
    );
  }
  if (!["text", "url", "number", "textarea", "readonly"].includes(type)) return null;

  const Component = type === "number" ? NumberField : TextField;
  const numeric = type === "number";
  return (
    <Component
      {...shared}
      type={numeric ? undefined : type === "readonly" || type === "textarea" ? undefined : type}
      multiline={type === "textarea"}
      readOnly={type === "readonly"}
      value={value ?? ""}
      placeholder={field.placeholder}
      maxLength={field.maxLength}
      min={field.min}
      max={field.max}
      step={field.step}
      rows={field.rows}
      spellCheck={field.spellCheck}
      onChange={(nextValue) => onChange(numeric ? toNumber(nextValue) : nextValue)}
      onBlur={(event) => onBlur(numeric ? toNumber(event.target.value) : event.target.value)}
    />
  );
}
