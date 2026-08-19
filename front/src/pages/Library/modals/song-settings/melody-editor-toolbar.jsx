import { IconButton } from "../../../../theme/ui";
import cx from "../../../../utils/cx";

export default function MelodyEditorToolbarButton({
  icon,
  label,
  disabled,
  danger,
  active,
  tone = "neutral",
  onClick
}) {
  return (
    <IconButton
      unstyled
      icon={icon}
      label={label}
      disabled={disabled}
      onClick={onClick}
      className={cx("melody-editor-tool", danger && "is-danger", active && "is-active", `tone-${tone}`)}
      iconSize={18}
    />
  );
}
