export default function Card({
  as: Component = "div",
  className = "",
  variant = "glass",
  children,
  ...props
}) {
  return (
    <Component
      className={`ui-card ui-card--${variant} ${className}`.trim()}
      {...props}
    >
      {children}
    </Component>
  );
}
