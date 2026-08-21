import { Info } from "lucide-react";
import IconButton from "../../IconButton";
import Tooltip from "../../Tooltip";

export default function FloatingLabel({ id, label, required = false, tooltip }) {
  if (!label) return null;
  return (
    <span className="ui-text-field-label-row">
      <label className="ui-text-field-label" htmlFor={id}>
        {label}
        {required && <span aria-hidden="true"> *</span>}
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
    </span>
  );
}
