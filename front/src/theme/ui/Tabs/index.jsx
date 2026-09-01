import { useId } from "react";
import mergeSx from "../_internal/sx";
import useControllable from "../_internal/useControllable";
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

  const [current, setCurrent] = useControllable(value, defaultValue ?? items[0]?.value, onChange);

  const activeItem = items.find((item) => item.value === current);

  const currentIndex = Math.max(
    0,
    items.findIndex((item) => item.value === current)
  );

  const move = (index, event) => {
    const item = items[index];

    if (item && !item.disabled) {
      setCurrent(item.value, event);
      event.currentTarget.querySelectorAll('[role="tab"]')[index]?.focus();
    }
  };

  const edge = (from, direction) => {
    for (let step = 1; step <= items.length; step += 1) {
      const index = (from + direction * step + items.length) % items.length;
      if (!items[index]?.disabled) return index;
    }
    return from;
  };

  return (
    <div className={`ui-tabs ${className}`.trim()} style={mergeSx(sx, style)}>
      {/* The tabs, not their tablist container, own the roving keyboard focus. */}
      {/* eslint-disable-next-line jsx-a11y/interactive-supports-focus */}
      <div
        className="ui-tabs-list"
        role="tablist"
        onKeyDown={(event) => {
          if (!items.length) return;

          if (event.key === "ArrowRight") {
            event.preventDefault();
            move(edge(currentIndex, 1), event);
          } else if (event.key === "ArrowLeft") {
            event.preventDefault();
            move(edge(currentIndex, -1), event);
          } else if (event.key === "Home") {
            event.preventDefault();
            move(
              items.findIndex((item) => !item.disabled),
              event
            );
          } else if (event.key === "End") {
            event.preventDefault();
            move(
              items.findLastIndex((item) => !item.disabled),
              event
            );
          }
        }}
      >
        {items.map((item) => {
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
              onClick={(event) => setCurrent(item.value, event)}
            >
              {item.icon && (
                <span className="ui-tab-icon" aria-hidden="true">
                  {item.icon}
                </span>
              )}

              <span className="ui-tab-label">{item.label}</span>
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
