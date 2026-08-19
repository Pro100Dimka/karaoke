import { X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { useI18n } from "../../i18n";
import { Card, IconButton } from "../../theme/ui";
import cx from "../../utils/cx";
import ModalTitle from "./title";

const FOCUSABLE_SELECTOR = [
  "button:not([disabled])",
  "[href]",
  "input:not([disabled])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  '[tabindex]:not([tabindex="-1"])'
].join(", ");

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
  ariaLabel,
  portal = false,
  closeIconSize = 20,
  tilt = true,
  titleProps,
  backdropClassName = "",
  modalClassName = "",
  closeClassName = "",
  closeAriaLabel,
  cardVariant = "neon",
  maxWidth
}) {
  const { t } = useI18n();
  const resolvedAriaLabel = ariaLabel || t("common.dialog");
  const resolvedCloseAriaLabel = closeAriaLabel || t("common.close");
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
      dialogRef.current.querySelector(FOCUSABLE_SELECTOR).focus();
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

      const focusable = Array.from(dialogRef.current.querySelectorAll(FOCUSABLE_SELECTOR));
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
      openModalStack.splice(openModalStack.lastIndexOf(token), 1);
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

  const backdropClasses = cx("app-modal-backdrop", backdropClassName);
  const modalClasses = cx("app-modal modal-card", modalClassName);
  const closeClasses = cx("app-modal-close", closeClassName);

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
            iconSize={closeIconSize}
            className={closeClasses}
            onClick={() => onCloseRef.current?.()}
            label={resolvedCloseAriaLabel}
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
          {resolvedAriaLabel}
        </span>
        {titleProps && <ModalTitle {...titleProps} />}
        <div className="app-modal-body">{children}</div>
      </Card>
    </div>
  );

  return portal ? createPortal(content, document.body) : content;
}
