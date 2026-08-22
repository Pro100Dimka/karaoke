import { X } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef } from "react";
import { createPortal } from "react-dom";
import Card from "../Card";
import IconButton from "../IconButton";
import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./modal.css";
import ModalTitle from "./title";

const FOCUSABLE =
  "button:not([disabled]),[href],input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex='-1'])";
const dialogs = [];
const sizes = { sm: "32rem", md: "42rem", lg: "52rem" };
let locks = 0;
let overflow = "";

const lockBody = () => {
  if (!locks) {
    overflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  locks += 1;
};

const unlockBody = () => {
  locks = Math.max(0, locks - 1);
  if (!locks) {
    document.body.style.overflow = overflow;
    overflow = "";
  }
};

export default function Modal({
  children,
  isOpen,
  onClose,
  ariaLabel = "Диалог",
  closeAriaLabel = "Закрыть",
  closeIconSize = 58,
  portal = false,
  tilt = true,
  titleProps,
  cardVariant = "neon",
  size = "md",
  maxWidth,
  backdropClassName,
  modalClassName,
  closeClassName
}) {
  const close = useRef(onClose);
  const dialog = useRef(null);
  const token = useRef(Symbol("modal"));
  const titleId = useId();
  useEffect(() => {
    close.current = onClose;
  }, [onClose]);

  useLayoutEffect(() => {
    if (!isOpen) return undefined;
    const { current } = token;
    const { activeElement: previous } = document;
    dialogs.push(current);
    lockBody();
    const frame = requestAnimationFrame(() => {
      if (dialogs.at(-1) === current)
        (dialog.current?.querySelector(FOCUSABLE) || dialog.current)?.focus();
    });
    const keydown = (event) => {
      if (dialogs.at(-1) !== current) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = [...(dialog.current?.querySelectorAll(FOCUSABLE) || [])];
      const first = items[0];
      const last = items.at(-1);
      if (!first || (event.shiftKey && document.activeElement === first)) {
        event.preventDefault();
        (last || dialog.current)?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", keydown, true);
    return () => {
      cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keydown, true);
      const top = dialogs.at(-1) === current;
      dialogs.splice(dialogs.lastIndexOf(current), 1);
      unlockBody();
      if (top && previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;
  const content = (
    <Primitive
      className={cx("ui-modal-backdrop", backdropClassName)}
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && dialogs.at(-1) === token.current)
          close.current?.();
      }}
    >
      <Card
        ref={dialog}
        as="section"
        variant={cardVariant}
        tilt={tilt}
        className={cx("ui-modal-dialog", modalClassName)}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        sx={{
          "--ui-modal-size": sizes[size] || sizes.md,
          maxInlineSize: maxWidth || "calc(100vw - var(--space-8))"
        }}
        overlay={
          <IconButton
            icon={X}
            iconSize={closeIconSize}
            unstyled
            className={cx("ui-modal-close", closeClassName)}
            onClick={() => close.current?.()}
            label={closeAriaLabel}
          />
        }
      >
        <Primitive as="span" id={titleId} className="ui-visually-hidden">
          {ariaLabel}
        </Primitive>
        {titleProps && <ModalTitle {...titleProps} />}
        <Primitive className="ui-modal-body">{children}</Primitive>
      </Card>
    </Primitive>
  );
  return portal ? createPortal(content, document.body) : content;
}

export { default as ModalCarouselNavigation } from "./carousel-navigation";
export { default as ModalTitle } from "./title";

