import { Info } from "lucide-react";
import IconButton from "../../IconButton";
import Tooltip from "../../Tooltip";
import cx from "../cx";
import "./field-label.css";

export default function FieldLabel({
  htmlFor,
  label,
  tooltip,
  required = false,
  className
}) {
  if (!label) return null;

  return (
    <div className={cx("ui-field-label-row", className)}>
      <label className="ui-field-label" htmlFor={htmlFor}>
        {label}
        {required && (
          <span className="ui-field-required" aria-hidden="true">
            {" "}*
          </span>
        )}
      </label>

      {tooltip && (
        <Tooltip title={tooltip} placement="top">
          <IconButton
            type="button"
            variant="ghost"
            size="sm"
            aria-label="Подробнее"
            onMouseDown={(event) => event.preventDefault()}
          >
            <Info size={14} />
          </IconButton>
        </Tooltip>
      )}
    </div>
  );
}
