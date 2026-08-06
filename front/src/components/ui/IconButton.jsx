export default function IconButton({
  icon: Icon,
  label,
  iconProps,
  size = 18,
  className = "",
  unstyled = false,
  ...props
}) {
  const buttonClassName = unstyled
    ? className
    : `icon-button ${className}`.trim();

  return (
    <button
      type="button"
      className={buttonClassName || undefined}
      aria-label={label}
      title={props.title ?? label}
      {...props}
    >
      <Icon size={size} aria-hidden="true" {...iconProps} />
    </button>
  );
}
