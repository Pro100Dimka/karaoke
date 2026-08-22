import { forwardRef } from "react";
import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./box.css";

const Box = forwardRef(({ as = "div", className, ...props }, ref) => (
  <Primitive ref={ref} as={as} className={cx("ui-box", className)} {...props} />
));

Box.displayName = "Box";
export default Box;
