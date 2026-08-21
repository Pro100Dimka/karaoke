import { FolderOpen } from "lucide-react";
import { forwardRef } from "react";

import IconButton from "../IconButton";
import TextField from "../TextField";
import cx from "../_internal/cx";

import "./folder-field.css";

const FolderField = forwardRef((
  {
    value = "",
    placeholder = "Выберите папку",
    disabled = false,
    onBrowse,
    readOnly = Boolean(onBrowse),
    browseLabel = "Выбрать папку",
    className,
    inputClassName,
    ...props
  },
  ref
) => {
  const browse = () => {
    if (!disabled) onBrowse?.();
  };

  return (
    <TextField
      {...props}
      ref={ref}
      value={value}
      placeholder={placeholder}
      readOnly={readOnly}
      disabled={disabled}
      title={value || browseLabel}
      className={cx("ui-folder-field", className)}
      inputClassName={cx("ui-folder-field-input", inputClassName)}
      onClick={onBrowse ? browse : undefined}
      end={onBrowse ? (
        <IconButton
          icon={FolderOpen}
          variant="ghost"
          size="sm"
          disabled={disabled}
          aria-label={browseLabel}
          title={browseLabel}
          onClick={browse}
        />
      ) : undefined}
    />
  );
});

FolderField.displayName = "FolderField";

export default FolderField;
