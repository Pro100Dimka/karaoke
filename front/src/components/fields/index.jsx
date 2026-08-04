import Dropdown from "./dropdown";

export default function FieldInput({
  id,
  field,
  value,
  onChange,
  onBlur = () => {},
  bare = false
}) {
  const inputId = id ?? `field-${field.name}`;

  const className = `input ${field.className ?? ""}`.trim();

  const commonProps = {
    id: inputId,
    className,
    disabled: field.disabled,
    required: field.required
  };

  const textProps = {
    ...commonProps,
    value: value ?? "",
    placeholder: field.placeholder,
    maxLength: field.maxLength,
    onChange: (event) => onChange(event.target.value),
    onBlur: (event) => onBlur(event.target.value)
  };

  const renderers = {
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
        onChange={(event) => {
          const nextValue = event.target.value;

          onChange(nextValue === "" ? null : Number(nextValue));
        }}
        onBlur={(event) => {
          const nextValue = event.target.value;

          onBlur(nextValue === "" ? null : Number(nextValue));
        }}
      />
    ),

    select: (
      <Dropdown
        id={inputId}
        value={value ?? ""}
        options={field.options ?? []}
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

    readonly: (
      <input
        {...commonProps}
        value={value ?? ""}
        placeholder={field.placeholder}
        readOnly
      />
    ),

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

  const control = renderers[field.type];

  if (!control) return null;
  if (bare) return control;

  const wrapperClassName =
    field.type === "toggle"
      ? `settings-toggle ${field.wrapperClassName ?? ""}`.trim()
      : `settings-field ${field.wrapperClassName ?? ""}`.trim();

  return (
    <label className={wrapperClassName} htmlFor={inputId}>
      <span>
        {field.label && <strong>{field.label}</strong>}
        {field.hint && <small>{field.hint}</small>}
      </span>

      {control}
    </label>
  );
}
