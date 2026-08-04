import { Dropdown } from "./Dropdown";

export default function FieldInput({ id, field, value, onChange, onBlur }) {
  const inputProps = { id, className: "input", value: value ?? "" };
  const renderers = {
    select: (
      <Dropdown
        id={id}
        value={value}
        options={field.options}
        onChange={onChange}
      />
    ),
    text: (
      <input
        {...inputProps}
        maxLength={field.maxLength}
        placeholder={field.placeholder}
        onChange={(event) => onChange(event.target.value)}
        onBlur={(event) => onBlur(event.target.value)}
      />
    ),
    number: (
      <input
        {...inputProps}
        type="number"
        min={field.min}
        max={field.max}
        onChange={(event) => {
          const nextValue = event.target.value;
          onChange(nextValue === "" ? "" : Number(nextValue));
        }}
      />
    ),
    readonly: <input {...inputProps} readOnly />,
    toggle: (
      <input
        id={id}
        type="checkbox"
        checked={Boolean(value)}
        onChange={(event) => onChange(event.target.checked)}
      />
    )
  };
  const inputId = `setting-${field.name}`;
  return (
    <label
      className={field.type === "toggle" ? "settings-toggle" : "settings-field"}
      htmlFor={inputId}
    >
      <span>
        <strong>{field.label}</strong>
        {field.hint && <small>{field.hint}</small>}
      </span>
      {renderers[field.type] ?? null}
    </label>
  );
}
