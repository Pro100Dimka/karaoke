import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";

export default function Modal({
  children,
  isOpen,
  onClose,
  ariaLabel,
  portal = false,
  backdropClassName = "",
  modalClassName = "",
  closeClassName = "",
  closeIconSize = 20,
  closeAriaLabel = "Закрыть"
}) {
  const dialogRef = useRef(null);
  const titleId = useId();

  useEffect(() => {
    if (!isOpen) {
      return undefined;
    }

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        onClose();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    dialogRef.current?.focus();

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [isOpen, onClose]);

  if (!isOpen) {
    return null;
  }

  const content = (
    <div className={backdropClassName}>
      <button
        type="button"
        aria-label={closeAriaLabel}
        tabIndex={-1}
        onClick={onClose}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          padding: 0,
          margin: 0,
          border: 0,
          background: "transparent",
          cursor: "default",
          zIndex: 0
        }}
      />

      <section
        ref={dialogRef}
        className={modalClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        style={{ position: "relative", zIndex: 1 }}
      >
        <span
          id={titleId}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0
          }}
        >
          {ariaLabel}
        </span>

        <button
          type="button"
          className={closeClassName}
          onClick={onClose}
          aria-label={closeAriaLabel}
        >
          <X size={closeIconSize} aria-hidden="true" />
        </button>

        {children}
      </section>
    </div>
  );

  return portal ? createPortal(content, document.body) : content;
}
