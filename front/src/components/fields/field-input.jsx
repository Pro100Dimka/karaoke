import { useId } from "react";
import Dropdown from "./Dropdown";
import Field from "./field";

const identity = () => {};

function toNumber(value) {
  return value === "" ? null : Number(value);
}

export default function FieldInput({
  id,
  field,
  value,
  onChange,
  onBlur = identity,
  bare = false
}) {
  const generatedId = useId();
  const inputId = id ?? `field-${field.name}-${generatedId.replace(/:/g, "")}`;
  const className = `input ${field.className ?? ""}`.trim();
  const commonProps = {
    id: inputId,
    className,
    disabled: field.disabled,
    required: field.required,
    "aria-invalid": Boolean(field.error) || undefined,
    "aria-describedby": field.hint ? `${inputId}-hint` : undefined
  };

  const textProps = {
    ...commonProps,
    value: value ?? "",
    placeholder: field.placeholder,
    maxLength: field.maxLength,
    onChange: (event) => onChange(event.target.value),
    onBlur: (event) => onBlur(event.target.value)
  };

  const controls = {
    text: <input {...textProps} type="text" />,
    url: <input {...textProps} type="url" />,
    number: (
      <input
        {...commonProps}
        type="number"
        value={value ?? ""}
        placeholder={field.placeholder}
        min={field.min}
        max={field.max}
        step={field.step}
        onChange={(event) => onChange(toNumber(event.target.value))}
        onBlur={(event) => onBlur(toNumber(event.target.value))}
      />
    ),
    select: (
      <Dropdown
        id={inputId}
        value={value ?? ""}
        options={field.options ?? []}
        placeholder={field.placeholder}
        disabled={field.disabled}
        onChange={onChange}
      />
    ),
    textarea: (
      <textarea
        {...commonProps}
        value={value ?? ""}
        placeholder={field.placeholder}
        maxLength={field.maxLength}
        rows={field.rows}
        spellCheck={field.spellCheck}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onBlur(event.target.value)}
      />
    ),
    readonly: <input {...commonProps} value={value ?? ""} readOnly />,
    toggle: (
      <input
        id={inputId}
        type="checkbox"
        checked={Boolean(value)}
        disabled={field.disabled}
        onChange={(event) => onChange(event.target.checked)}
        onBlur={(event) => onBlur(event.target.checked)}
      />
    )
  };

  const control = controls[field.type ?? "text"];
  if (!control) return null;
  if (bare) return control;

  return (
    <Field
      id={inputId}
      label={field.label}
      hint={field.hint}
      error={field.error}
      inline={field.type === "toggle"}
      className={field.wrapperClassName}
      variant={field.variant}
    >
      {control}
    </Field>
  );
}
