import { Check, ChevronDown } from "lucide-react";

export default function MonitoringModePicker({
  modes,
  value,
  isOpen,
  disabled,
  menuRef,
  onToggle,
  onChange
}) {
  const selected = modes.find((mode) => mode.id === value) || modes[0];
  if (!selected) return null;

  const { Icon } = selected;

  return (
    <div
      className="monitoring-mode-picker legacy-browser-monitoring"
      ref={menuRef}
    >
      <span>Режим прослушивания</span>
      <button
        type="button"
        className="monitoring-mode-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        onClick={onToggle}
      >
        <Icon size={15} />
        <span>{selected.title}</span>
        <ChevronDown size={15} />
      </button>
      {isOpen && (
        <div
          className="monitoring-mode-menu"
          role="listbox"
          aria-label="Режим прослушивания"
        >
          <div className="monitoring-mode-menu-title">
            Выберите способ прослушивания
          </div>
          {modes.map(({ id, title, description, Icon: OptionIcon }) => {
            const isSelected = id === value;
            return (
              <button
                type="button"
                role="option"
                aria-selected={isSelected}
                key={id}
                className={`monitoring-mode-option ${isSelected ? "is-selected" : ""}`}
                onClick={() => onChange(id)}
              >
                <OptionIcon size={17} />
                <span className="monitoring-mode-option-copy">
                  <strong>{title}</strong>
                  <small>{description}</small>
                </span>
                {isSelected && (
                  <Check className="monitoring-mode-check" size={17} />
                )}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
