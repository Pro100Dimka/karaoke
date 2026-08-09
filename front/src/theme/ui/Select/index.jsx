import { forwardRef } from "react";
import Field from "../_internal/Field";
import { optionItem } from "../_internal/option";
import "./select.css";

const Select = forwardRef(function Select({
  id,
  label,
  hint,
  error,
  options = [],
  value,
  defaultValue,
  onChange,
  className = "",
  ...props
}, ref) {
  const control = fieldProps => (
    <select
      ref={ref}
      className={`ui-select ui-control ui-focus-shadow ui-disabled ${className}`.trim()}
      value={value}
      defaultValue={value === undefined ? defaultValue : undefined}
      onChange={event => onChange?.(event.target.value, event)}
      {...fieldProps}
      {...props}
    >
      {options.map(option => {
        const item = optionItem(option);
        return <option key={item.value} value={item.value}>{item.label}</option>;
      })}
    </select>
  );

  return label || hint || error
    ? <Field id={id} label={label} hint={hint} error={error}>{control}</Field>
    : control({ id });
});

export default Select;
