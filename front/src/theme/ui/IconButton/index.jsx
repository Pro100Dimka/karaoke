import { forwardRef } from "react";
import Button from "../Button";
import cx from "../_internal/cx";
import "./icon-button.css";

const IconButton = forwardRef(
  (
    { size = "md", className, "aria-label": ariaLabel, title, ...props },
    ref
  ) => {
    if (import.meta.env?.DEV && !ariaLabel && !title)
      console.warn("[Light UI] IconButton needs aria-label or title.");

    return (
      <Button
        ref={ref}
        size={size}
        className={cx("ui-icon-button", className)}
        aria-label={ariaLabel}
        title={title}
        {...props}
      />
    );
  }
);

export default IconButton;
