import { forwardRef } from "react";

const unit = (value) => (typeof value === "number" ? `${value}px` : value);

const Primitive = forwardRef(function Primitive(
  {
    as: Component = "div",
    sx,
    style,
    p,
    px,
    py,
    pt,
    pr,
    pb,
    pl,
    m,
    mx,
    my,
    mt,
    mr,
    mb,
    ml,
    ...props
  },
  ref
) {
  const spacing = {
    ...(p != null && { padding: unit(p) }),
    ...(px != null && { paddingInline: unit(px) }),
    ...(py != null && { paddingBlock: unit(py) }),
    ...(pt != null && { paddingTop: unit(pt) }),
    ...(pr != null && { paddingRight: unit(pr) }),
    ...(pb != null && { paddingBottom: unit(pb) }),
    ...(pl != null && { paddingLeft: unit(pl) }),
    ...(m != null && { margin: unit(m) }),
    ...(mx != null && { marginInline: unit(mx) }),
    ...(my != null && { marginBlock: unit(my) }),
    ...(mt != null && { marginTop: unit(mt) }),
    ...(mr != null && { marginRight: unit(mr) }),
    ...(mb != null && { marginBottom: unit(mb) }),
    ...(ml != null && { marginLeft: unit(ml) })
  };

  return (
    <Component
      ref={ref}
      style={{ ...spacing, ...sx, ...style }}
      {...props}
    />
  );
});

export default Primitive;
