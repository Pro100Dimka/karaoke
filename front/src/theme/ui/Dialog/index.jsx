import { useId } from "react";
import Modal from "../Modal";
import "./dialog.css";

export default function Dialog({
  open,
  title,
  children,
  actions,
  onClose,
  className = ""
}) {
  const id = useId().replace(/:/g, "");
  const titleId = title ? `${id}-title` : undefined;

  return (
    <Modal
      open={open}
      onClose={onClose}
      className={`ui-dialog ${className}`.trim()}
      aria-labelledby={titleId}
    >
      {title && <h2 id={titleId} className="ui-dialog-title">{title}</h2>}
      <div className="ui-dialog-content">{children}</div>
      {actions && <div className="ui-dialog-actions">{actions}</div>}
    </Modal>
  );
}
