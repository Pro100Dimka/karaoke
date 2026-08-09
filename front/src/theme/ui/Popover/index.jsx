import { forwardRef } from "react";
import "./popover.css";

const Popover = forwardRef(function Popover({
  open,
  children,
  className = "",
  ...props
}, ref) {
  return (
    <div
      ref={ref}
      className={`ui-popover ${className}`.trim()}
      data-open={open || undefined}
      {...props}
    >
      {children}
    </div>
  );
});

export default Popover;
