export default function Button({
  children,
  icon: Icon,
  iconProps,
  iconSize = 15,
  variant = "default",
  className = "",
  type = "button",
  unstyled = false,
  ...props
}) {
  const buttonClassName = unstyled
    ? className
    : `btn btn-${variant} ${className}`.trim();

  return (
    <button type={type} className={buttonClassName || undefined} {...props}>
      {Icon && <Icon size={iconSize} {...iconProps} />}
      {children}
    </button>
  );
}
