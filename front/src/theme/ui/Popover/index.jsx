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
    if (!open || !onClose) return undefined;

    const closeOutside = (event) => {
      if (!popoverRef.current?.contains(event.target)) onClose(event);
    };
    const closeOnEscape = (event) => event.key === "Escape" && onClose(event);

    document.addEventListener("click", closeOutside);
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.removeEventListener("click", closeOutside);
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose, open]);

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
