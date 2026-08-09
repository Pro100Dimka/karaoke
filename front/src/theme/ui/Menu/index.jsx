import { useRef } from "react";
import mergeSx from "../_internal/sx";
import "./menu.css";

export default function Menu({ items = [], onSelect, className = "", sx, style }) {
  const ref = useRef(null);

  const move = (from, step) => {
    const buttons = [...(ref.current?.querySelectorAll('[role="menuitem"]:not(:disabled)') || [])];
    if (!buttons.length) return;

    const index = Math.max(0, buttons.indexOf(document.activeElement));
    buttons[(index + step + buttons.length) % buttons.length]?.focus();
  };

  return (
    <div
      ref={ref}
      className={`ui-menu ${className}`.trim()}
      role="menu"
      style={mergeSx(sx, style)}
      onKeyDown={event => {
        if (event.key === "ArrowDown") {
          event.preventDefault();
          move(0, 1);
        } else if (event.key === "ArrowUp") {
          event.preventDefault();
          move(0, -1);
        } else if (event.key === "Home") {
          event.preventDefault();
          ref.current?.querySelector('[role="menuitem"]:not(:disabled)')?.focus();
        } else if (event.key === "End") {
          event.preventDefault();
          const buttons = ref.current?.querySelectorAll('[role="menuitem"]:not(:disabled)');
          buttons?.[buttons.length - 1]?.focus();
        }
      }}
    >
      {items.map(item => (
        <button
          key={item.value ?? item.label}
          type="button"
          role="menuitem"
          className="ui-menu-item"
          disabled={item.disabled}
          onClick={event => onSelect?.(item.value, item, event)}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
