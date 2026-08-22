import { forwardRef, useEffect, useRef } from "react";
import mergeRefs from "../_internal/mergeRefs";
import "./popover.css";

const Popover = forwardRef(({
  open,
  onClose,
  children,
  className = "",
  ...props
}, ref) => {
  const popoverRef = useRef(null);

  useEffect(() => {
    if (!open || !onClose) return;

    const closeOutside = (event) => {
      if (!popoverRef.current?.contains(event.target)) {
        onClose(event);
      }
    };

    const closeOnEscape = (event) => {
      if (event.key === "Escape") {
        onClose(event);
      }
    };

    document.addEventListener("pointerdown", closeOutside);
    document.addEventListener("keydown", closeOnEscape);

    return () => {
      document.removeEventListener("pointerdown", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [open, onClose]);

  return (
    <div
      ref={mergeRefs(ref, popoverRef)}
      className={`ui-popover ${className}`.trim()}
      data-open={open || undefined}
      {...props}
    >
      {children}
    </div>
  );
});

export default Popover;