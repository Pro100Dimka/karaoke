import { IconButton } from "../../../../components/ui";

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
      size={18}
    />
  );
}
