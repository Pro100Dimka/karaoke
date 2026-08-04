export default function Button({
  children,
  icon: Icon,
  variant = "default",
  className = "",
  ...props
}) {
  return (
    <button className={`btn btn-${variant} ${className}`.trim()} {...props}>
      {Icon && <Icon size={15} />}
      {children}
    </button>
  );
}
