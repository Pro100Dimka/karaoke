import FieldInput from "./field-input";

export default function FieldList({
  fields,
  values,
  onChange,
  onBlur,
  className = ""
}) {
  return (
    <div className={className || undefined}>
      {fields.map((field) => (
        <FieldInput
          key={field.name}
          field={field}
          value={values[field.name]}
          onChange={(value) => onChange(field.name, value)}
          onBlur={(value) => onBlur?.(field.name, value, field)}
        />
      ))}
    </div>
  );
}
