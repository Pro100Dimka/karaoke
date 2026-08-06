import { X } from "lucide-react";
import { useEffect, useId, useRef } from "react";
import { createPortal } from "react-dom";
import { IconButton } from "./ui";
import Card from "./ui/Card";
import { FOCUSABLE_SELECTOR } from "./modal-focus";

export default function Modal({
  children,
  isOpen,
  onClose,
  ariaLabel = "Диалог",
  portal = false,
  backdropClassName = "modal-backdrop",
  modalClassName = "modal",
  closeClassName = "modal-close",
  closeIconSize = 20,
  closeAriaLabel = "Закрыть",
  cardVariant = null,
  tilt = true
}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    const previouslyFocused = document.activeElement;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const frameId = requestAnimationFrame(() => {
      const firstFocusable =
        dialogRef.current?.querySelector(FOCUSABLE_SELECTOR);
      (firstFocusable || dialogRef.current)?.focus();
    });

    const handleKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current?.();
        return;
      }

      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll(FOCUSABLE_SELECTOR) ?? []
      );
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable.at(-1);
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previouslyFocused instanceof HTMLElement) previouslyFocused.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const content = (
    <div
      className={backdropClassName}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <Card
        ref={dialogRef}
        as="section"
        variant={cardVariant ?? "glass"}
        tilt={tilt}
        className={modalClassName}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <span id={titleId} className="sr-only">
          {ariaLabel}
        </span>
        <IconButton
          unstyled
          icon={X}
          size={closeIconSize}
          className={closeClassName}
          onClick={onClose}
          label={closeAriaLabel}
        />
        {children}
      </Card>
    </div>
  );

  return portal ? createPortal(content, document.body) : content;
}
