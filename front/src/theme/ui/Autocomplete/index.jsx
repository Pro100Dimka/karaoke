import { useEffect, useId, useRef, useState } from "react";
import TextField from "../TextField";
import useClickOutside from "../_internal/useClickOutside";
import useControllable from "../_internal/useControllable";
import { optionText } from "../_internal/option";
import "./autocomplete.css";

export default function Autocomplete({
  options = [],
  value,
  defaultValue = null,
  inputValue,
  defaultInputValue = "",
  onChange,
  onInputChange,
  getOptionLabel = optionText,
  isOptionEqualToValue = Object.is,
  filter,
  placeholder,
  loading = false,
  loadingText = "Загрузка…",
  emptyText = "Ничего не найдено",
  clearable = true,
  disabled = false,
  onFocus,
  onKeyDown,
  ...props
}) {
  const id = useId().replace(/:/g, "");
  const listId = `${id}-listbox`;
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(-1);
  const [selected, setSelected] = useControllable(value, defaultValue, onChange);
  const [query, setQuery] = useControllable(
    inputValue,
    defaultInputValue || (value != null ? getOptionLabel(value) : ""),
    onInputChange
  );

  useClickOutside(rootRef, () => setOpen(false), open);

  const q = String(query || "").trim().toLocaleLowerCase();
  const filtered = filter
    ? filter(options, query)
    : q
      ? options.filter(option =>
          getOptionLabel(option).toLocaleLowerCase().includes(q)
        )
      : options;

  useEffect(() => {
    if (active < 0) return;
    listRef.current
      ?.querySelector(`#${CSS.escape(`${id}-option-${active}`)}`)
      ?.scrollIntoView({ block: "nearest" });
  }, [active, id]);

  const choose = (option, event) => {
    setSelected(option, event);
    setQuery(getOptionLabel(option), event);
    setOpen(false);
    setActive(-1);
  };

  const activeId = open && active >= 0 ? `${id}-option-${active}` : undefined;

  return (
    <div ref={rootRef} className="ui-autocomplete">
      <TextField
        {...props}
        value={query}
        placeholder={placeholder}
        disabled={disabled}
        role="combobox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={activeId}
        aria-autocomplete="list"
        autoComplete="off"
        end={
          clearable && query ? (
            <button
              type="button"
              className="ui-autocomplete-clear"
              aria-label="Очистить"
              onMouseDown={event => event.preventDefault()}
              onClick={event => {
                setSelected(null, event);
                setQuery("", event);
                setOpen(false);
                setActive(-1);
              }}
            >
              ×
            </button>
          ) : null
        }
        onFocus={event => {
          onFocus?.(event);
          if (!event.defaultPrevented) setOpen(true);
        }}
        onChange={(next, event) => {
          setQuery(next, event);
          setOpen(true);
          setActive(-1);
        }}
        onKeyDown={event => {
          onKeyDown?.(event);
          if (event.defaultPrevented) return;

          if (event.key === "ArrowDown") {
            event.preventDefault();
            setOpen(true);
            setActive(index => Math.min(index + 1, filtered.length - 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
            setActive(index => Math.max(index - 1, 0));
          } else if (event.key === "Home" && open) {
            event.preventDefault();
            setActive(filtered.length ? 0 : -1);
          } else if (event.key === "End" && open) {
            event.preventDefault();
            setActive(filtered.length - 1);
          } else if (event.key === "Enter" && open && active >= 0) {
            event.preventDefault();
            choose(filtered[active], event);
          } else if (event.key === "Escape") {
            setOpen(false);
            setActive(-1);
          }
        }}
      />

      {open && (
        <div
          ref={listRef}
          id={listId}
          className="ui-autocomplete-list"
          role="listbox"
        >
          {loading ? (
            <div className="ui-autocomplete-empty">{loadingText}</div>
          ) : filtered.length ? (
            filtered.map((option, index) => {
              const label = getOptionLabel(option);
              const isSelected =
                selected != null && isOptionEqualToValue(option, selected);

              return (
                <button
                  id={`${id}-option-${index}`}
                  key={option?.id ?? option?.value ?? `${label}-${index}`}
                  type="button"
                  role="option"
                  aria-selected={isSelected}
                  className="ui-autocomplete-option"
                  data-active={index === active || undefined}
                  data-selected={isSelected || undefined}
                  onMouseEnter={() => setActive(index)}
                  onMouseDown={event => event.preventDefault()}
                  onClick={event => choose(option, event)}
                >
                  {label}
                </button>
              );
            })
          ) : (
            <div className="ui-autocomplete-empty">{emptyText}</div>
          )}
        </div>
      )}
    </div>
  );
}
