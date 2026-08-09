import { useId } from "react";
import useControllable from "../_internal/useControllable";
import mergeSx from "../_internal/sx";
import "./tabs.css";

export default function Tabs({
  items = [],
  value,
  defaultValue,
  onChange,
  className = "",
  sx,
  style
}) {
  const id = useId().replace(/:/g, "");
  const [current, setCurrent] = useControllable(
    value,
    defaultValue ?? items[0]?.value,
    onChange
  );
  const activeItem = items.find(item => item.value === current);
  const currentIndex = Math.max(0, items.findIndex(item => item.value === current));

  const move = (index, event) => {
    const item = items[index];
    if (item && !item.disabled) setCurrent(item.value, event);
  };

  return (
    <div className={`ui-tabs ${className}`.trim()} style={mergeSx(sx, style)}>
      <div
        className="ui-tabs-list"
        role="tablist"
        onKeyDown={event => {
          if (!items.length) return;

          if (event.key === "ArrowRight") {
            event.preventDefault();
            move((currentIndex + 1) % items.length, event);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            move((currentIndex - 1 + items.length) % items.length, event);
          } else if (event.key === "Home") {
            event.preventDefault();
            move(0, event);
          } else if (event.key === "End") {
            event.preventDefault();
            move(items.length - 1, event);
          }
        }}
      >
        {items.map(item => {
          const active = item.value === current;
          const tabId = `${id}-tab-${item.value}`;
          const panelId = `${id}-panel-${item.value}`;

          return (
            <button
              key={item.value}
              id={tabId}
              type="button"
              role="tab"
              aria-selected={active}
              aria-controls={panelId}
              tabIndex={active ? 0 : -1}
              disabled={item.disabled}
              className="ui-tab"
              data-active={active || undefined}
              onClick={event => setCurrent(item.value, event)}
            >
              {item.label}
            </button>
          );
        })}
      </div>

      {activeItem && (
        <div
          id={`${id}-panel-${activeItem.value}`}
          className="ui-tab-panel"
          role="tabpanel"
          aria-labelledby={`${id}-tab-${activeItem.value}`}
        >
          {activeItem.content}
        </div>
      )}
    </div>
  );
}
