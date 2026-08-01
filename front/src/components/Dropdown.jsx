import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";

export function Dropdown({ value, onChange, options, placeholder = "Выберите…", disabled = false, className = "" }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const idRef = useRef(`dropdown-${Math.random().toString(36).slice(2)}`);
  const selected = options.find((option) => String(option.value) === String(value));

  useEffect(() => {
    const close = (event) => {
      if (!ref.current?.contains(event.target)) setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    // Settings modals stop bubbling mouse events. Capture sees the click
    // before that handler, so a dropdown always closes outside itself.
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, []);

  useEffect(() => {
    const closeWhenAnotherOpens = (event) => {
      if (event.detail !== idRef.current) setOpen(false);
    };
    window.addEventListener("karaoke-dropdown-open", closeWhenAnotherOpens);
    return () => window.removeEventListener("karaoke-dropdown-open", closeWhenAnotherOpens);
  }, []);

  const toggle = () => {
    if (!open) window.dispatchEvent(new CustomEvent("karaoke-dropdown-open", { detail: idRef.current }));
    setOpen((current) => !current);
  };

  return (
    <div className={`app-dropdown ${className}`} ref={ref}>
      <button type="button" className="app-dropdown-trigger" disabled={disabled} aria-haspopup="listbox"
        aria-expanded={open} onClick={toggle}>
        <span>{selected?.label || placeholder}</span><ChevronDown size={15} />
      </button>
      {open && <div className="app-dropdown-menu" role="listbox">
        {options.map((option) => {
          const isSelected = String(option.value) === String(value);
          return <button type="button" key={String(option.value)} role="option" aria-selected={isSelected}
            className={`app-dropdown-option ${isSelected ? "is-selected" : ""}`}
            onClick={() => { onChange(option.value); setOpen(false); }}>
            <span>{option.label}</span>{isSelected && <Check size={15} />}
          </button>;
        })}
      </div>}
    </div>
  );
}
