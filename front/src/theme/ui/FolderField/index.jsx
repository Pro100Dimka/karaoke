import { FolderOpen } from "lucide-react";
import { forwardRef } from "react";

import Field from "../_internal/Field";
import cx from "../_internal/cx";
import mergeSx from "../_internal/sx";
import IconButton from "../IconButton";

import "./folder-field.css";

const FolderField = forwardRef(function FolderField(
  {
    id,
    label,
    hint,
    tooltip,
    error,
    value = "",
    placeholder = "Выберите папку",
    disabled = false,
    browseLabel = "Выбрать папку",
    onBrowse,
    className,
    fieldClassName,
    sx,
    style,
    ...props
  },
  ref
) {
  const control = (fieldProps = {}) => (
    <div
      className={cx("ui-folder-field ui-control ui-motion", className)}
      data-disabled={disabled || undefined}
      data-error={!!error || undefined}
      style={mergeSx(sx, style)}
    >
      <input
        ref={ref}
        className="ui-folder-field__input"
        value={value ?? ""}
        placeholder={placeholder}
        readOnly
        disabled={disabled}
        title={value || undefined}
        {...fieldProps}
        {...props}
      />

      <IconButton
        className="ui-folder-field__browse"
        variant="ghost"
        size="sm"
        disabled={disabled}
        aria-label={browseLabel}
        title={browseLabel}
        onClick={onBrowse}
      >
        <FolderOpen size={17} aria-hidden="true" />
      </IconButton>
    </div>
  );

  return label || hint || error ? (
    <Field
      id={id}
      label={label}
      tooltip={tooltip}
      hint={hint}
      error={error}
      disabled={disabled}
      className={fieldClassName}
    >
      {control}
    </Field>
  ) : (
    control({ id })
  );
});

export default FolderField;
