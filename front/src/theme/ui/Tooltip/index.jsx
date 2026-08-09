import { cloneElement, useEffect, useId, useRef, useState } from "react";
import "./tooltip.css";

export default function Tooltip({
  title,
  children,
  delay = 350,
  placement = "top",
  disabled = false
}) {
  const id = useId();
  const timerRef = useRef();
  const [open, setOpen] = useState(false);

  useEffect(() => () => clearTimeout(timerRef.current), []);

  const show = () => {
    if (disabled) return;
    clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setOpen(true), delay);
  };

  const hide = () => {
    clearTimeout(timerRef.current);
    setOpen(false);
  };

  const child = cloneElement(children, {
    "aria-describedby": open ? id : children.props["aria-describedby"],
    onFocus: event => {
      children.props.onFocus?.(event);
      if (!event.defaultPrevented) show();
    },
    onBlur: event => {
      children.props.onBlur?.(event);
      if (!event.defaultPrevented) hide();
    },
    onMouseEnter: event => {
      children.props.onMouseEnter?.(event);
      if (!event.defaultPrevented) show();
    },
    onMouseLeave: event => {
      children.props.onMouseLeave?.(event);
      if (!event.defaultPrevented) hide();
    }
  });

  return (
    <span className="ui-tooltip-anchor" data-placement={placement}>
      {child}
      {open && (
        <span id={id} role="tooltip" className="ui-tooltip">
          {title}
        </span>
      )}
    </span>
  );
}
