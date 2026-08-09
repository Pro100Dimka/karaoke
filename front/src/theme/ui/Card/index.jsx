import Primitive from "../_internal/Primitive";
import cx from "../_internal/cx";
import "./card.css";

export default function Card({
  as = "section",
  surface = "base",
  elevation = 0,
  interactive = false,
  loading = false,
  className,
  style,
  ...props
}) {
  return (
    <Primitive
      as={as}
      className={cx("ui-card", className)}
      data-surface={surface}
      data-interactive={interactive || undefined}
      data-loading={loading || undefined}
      style={{ "--card-shadow": `var(--shadows-${elevation})`, ...style }}
      {...props}
    />
  );
}
