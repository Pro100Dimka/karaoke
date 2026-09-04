import { translateSaved as tr } from "../../../i18n/runtime";
import Primitive from "../_internal/Primitive";
import "./chip.css";

export default function Chip({
  as = "span",
  tone = "default",
  variant = "soft",
  size = "md",
  selected = false,
  removable = false,
  onRemove,
  className = "",
  children,
  ...props
}) {
  return (
    <Primitive
      as={as}
      className={`ui-chip ${className}`.trim()}
      data-tone={tone}
      data-variant={variant}
      data-size={size}
      data-selected={selected || undefined}
      {...props}
    >
      {children}
      {removable && (
        <button
          type="button"
          className="ui-chip-remove"
          aria-label={tr("editor.delete")}
          onClick={(event) => {
            event.stopPropagation();
            onRemove?.(event);
          }}
        >
          ×
        </button>
      )}
    </Primitive>
  );
}
