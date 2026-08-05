export default function ModalTitle({
  icon: Icon,
  eyebrow,
  title,
  description,
  actions,
  className = ""
}) {
  return (
    <header className={`modal-title ${className}`.trim()}>
      {Icon && (
        <div className="modal-title__icon" aria-hidden="true">
          <Icon size={24} />
        </div>
      )}

      <div className="modal-title__copy">
        {eyebrow && <span className="modal-title__eyebrow">{eyebrow}</span>}
        <h1 className="modal-title__heading">{title}</h1>
        {description && (
          <p className="modal-title__description">{description}</p>
        )}
      </div>

      {actions && <div className="modal-title__actions">{actions}</div>}
    </header>
  );
}
