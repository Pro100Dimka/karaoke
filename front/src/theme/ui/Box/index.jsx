import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./box.css";

export default function Box({ as = "div", className, ...props }) {
  return <Primitive as={as} className={cx("ui-box", className)} {...props} />;
}
