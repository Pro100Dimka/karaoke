/* eslint-disable consistent-return */
import {
  cloneElement,
  isValidElement,
  useEffect,
  useId,
  useRef,
  useState
} from "react";
import { createPortal } from "react-dom";
import "./tooltip.css";

export default function Tooltip({
  title,
  children,
  placement = "top",
  disabled = false
}) {
  const id = useId();
  const triggerRef = useRef(null);

  const [open, setOpen] = useState(false);
  const [position, setPosition] = useState(null);

  const updatePosition = () => {
    const element = triggerRef.current;
    if (!element) return;
    const rect = element.getBoundingClientRect();
    const gap = 3;
    switch (placement) {
      case "bottom":
        setPosition({
          top: rect.bottom + gap,
          left: rect.left + rect.width / 2
        });
        break;
      case "left":
        setPosition({
          top: rect.top + rect.height / 2,
          left: rect.left - gap
        });
        break;
      case "right":
        setPosition({
          top: rect.top + rect.height / 2,
          left: rect.right + gap
        });
        break;
      default:
        setPosition({
          top: rect.top - gap,
          left: rect.left + rect.width / 2
        });
    }
  };

  const show = () => {
    if (disabled || !title) return;

    updatePosition();
    setOpen(true);
  };

  const hide = () => {
    setOpen(false);
  };

  useEffect(() => {
    if (!open) return;

    const update = () => {
      updatePosition();
    };

    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);

    return () => {
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [open, placement]);

  if (!title || disabled) {
    return children;
  }

  const trigger = isValidElement(children) ? (
    cloneElement(children, {
      ref: triggerRef,

      "aria-describedby": open ? id : undefined,

      onMouseEnter: (event) => {
        children.props.onMouseEnter?.(event);
        show();
      },

      onMouseLeave: (event) => {
        children.props.onMouseLeave?.(event);
        hide();
      },

      onFocus: (event) => {
        children.props.onFocus?.(event);
        show();
      },

      onBlur: (event) => {
        children.props.onBlur?.(event);
        hide();
      }
    })
  ) : (
    <span
      ref={triggerRef}
      className="ui-tooltip-trigger"
      aria-describedby={open ? id : undefined}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
    >
      {children}
    </span>
  );

  return (
    <>
      {trigger}

      {open &&
        position &&
        createPortal(
          <div
            id={id}
            role="tooltip"
            className="ui-tooltip"
            data-placement={placement}
            style={{
              top: position.top,
              left: position.left
            }}
          >
            {title}
          </div>,
          document.body
        )}
    </>
  );
}
