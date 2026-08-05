export default function Panel({ title, actions, children, className = "" }) {
  return (
    <section className={`panel ${className}`.trim()}>
      {title && (
        <header className="panel-header">
          <div className="panel-title">{title}</div>
          {actions}
        </header>
      )}
      {children}
    </section>
  );
}
