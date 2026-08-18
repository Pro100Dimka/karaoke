import { IconButton } from "../../../../theme/ui";

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
      className={[
        "melody-editor-tool",
        danger && "is-danger",
        active && "is-active",
        `tone-${tone}`
      ]
        .filter(Boolean)
        .join(" ")}
      iconSize={18}
    />
  );
}
