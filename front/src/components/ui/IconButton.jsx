export default function IconButton({
  icon: Icon,
  label,
  size = 18,
  className = "",
  ...props
}) {
  return (
    <button
      type="button"
      className={`icon-button ${className}`.trim()}
      aria-label={label}
      title={props.title ?? label}
      {...props}
    >
      <Icon size={size} aria-hidden="true" />
    </button>
  );
}
