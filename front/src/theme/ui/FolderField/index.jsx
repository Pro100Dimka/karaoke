import { FolderOpen } from "lucide-react";
import { forwardRef } from "react";

import Field from "../_internal/Field";
import cx from "../_internal/cx";
import IconButton from "../IconButton";
import InputBase from "../InputBase";

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
    <InputBase
      component="div"
      disableNativeDisabled
      className={cx("ui-folder-field ui-control ui-motion", className)}
      disabled={disabled}
      error={!!error}
      sx={sx}
      style={style}
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
    </InputBase>
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
