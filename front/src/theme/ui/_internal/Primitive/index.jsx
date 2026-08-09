import { forwardRef } from "react";

const Primitive = forwardRef(function Primitive(
  { as: Component = "div", ...props },
  ref
) {
  return <Component ref={ref} {...props} />;
});

export default Primitive;
