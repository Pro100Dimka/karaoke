import { X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { FOCUSABLE_SELECTOR } from "../modal-focus";
import { IconButton } from "../ui";
import Card from "../ui/Card";
import ModalTitle from "./title";

const openModalStack = [];
let bodyLockCount = 0;
let previousOverflow = "";

function lockBodyScroll() {
  if (bodyLockCount === 0) {
    previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyLockCount += 1;
}

function unlockBodyScroll() {
  bodyLockCount = Math.max(0, bodyLockCount - 1);
  if (bodyLockCount === 0) {
    document.body.style.overflow = previousOverflow;
    previousOverflow = "";
  }
}

export default function Modal({
  children,
  isOpen,
  onClose,
  ariaLabel = "Диалог",
  portal = false,
  closeIconSize = 20,
  tilt = true,
  titleProps,
  backdropClassName = "",
  modalClassName = "",
  closeClassName = "",
  closeAriaLabel = "Закрыть",
  cardVariant = "neon",
  maxWidth
}) {
  const dialogRef = useRef(null);
  const onCloseRef = useRef(onClose);
  const modalTokenRef = useRef(Symbol("modal"));
  const titleId = useId();

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;

    const token = modalTokenRef.current;
    const previouslyFocused = document.activeElement;
    openModalStack.push(token);
    lockBodyScroll();

    const frameId = requestAnimationFrame(() => {
      if (openModalStack.at(-1) !== token) return;
      const firstFocusable =
        dialogRef.current?.querySelector(FOCUSABLE_SELECTOR);
      (firstFocusable || dialogRef.current)?.focus();
    });

    const handleKeyDown = (event) => {
      if (openModalStack.at(-1) !== token) return;

      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
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

    document.addEventListener("keydown", handleKeyDown, true);

    return () => {
      cancelAnimationFrame(frameId);
      document.removeEventListener("keydown", handleKeyDown, true);
      const wasTopModal = openModalStack.at(-1) === token;
      const stackIndex = openModalStack.lastIndexOf(token);
      if (stackIndex >= 0) openModalStack.splice(stackIndex, 1);
      unlockBodyScroll();

      if (
        wasTopModal &&
        previouslyFocused instanceof HTMLElement &&
        previouslyFocused.isConnected
      ) {
        previouslyFocused.focus();
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const joinClasses = (...values) =>
    [
      ...new Set(
        values
          .flatMap((value) => String(value || "").split(/\s+/))
          .filter(Boolean)
      )
    ].join(" ");

  const backdropClasses = joinClasses("app-modal-backdrop", backdropClassName);
  const modalClasses = joinClasses("app-modal modal-card", modalClassName);
  const closeClasses = joinClasses("app-modal-close", closeClassName);

  const content = (
    <div
      className={backdropClasses}
      role="presentation"
      onMouseDown={(event) =>
        event.target === event.currentTarget &&
        openModalStack.at(-1) === modalTokenRef.current &&
        onCloseRef.current?.()
      }
    >
      <Card
        ref={dialogRef}
        as="section"
        variant={cardVariant}
        tilt={tilt}
        className={modalClasses}
        style={maxWidth ? { maxInlineSize: maxWidth, maxWidth } : undefined}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        overlay={
          <IconButton
            unstyled
            icon={X}
            size={closeIconSize}
            className={closeClasses}
            onClick={() => onCloseRef.current?.()}
            label={closeAriaLabel}
            style={{
              background: "var(--color-bg-elevated)",
              opacity: 1,
              backdropFilter: "none",
              WebkitBackdropFilter: "none"
            }}
          />
        }
      >
        <span id={titleId} className="sr-only">
          {ariaLabel}
        </span>
        {titleProps && <ModalTitle {...titleProps} />}
        {children}
      </Card>
    </div>
  );

  return portal ? createPortal(content, document.body) : content;
}
