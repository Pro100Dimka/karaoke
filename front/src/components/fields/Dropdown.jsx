import { Check, ChevronDown } from "lucide-react";
import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { translateSaved } from "../../i18n/runtime";
import Button from "./button";

export default function Dropdown({
  id,
  value,
  onChange,
  options = [],
  placeholder = translateSaved("Выберите…"),
  disabled = false,
  className = "",
  onBlur,
  onKeyDown,
  ariaInvalid,
  ariaDescribedBy
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);
  const menuRef = useRef(null);
  const [menuStyle, setMenuStyle] = useState(null);
  const generatedId = useId();
  const dropdownId = id ?? `dropdown-${generatedId.replace(/:/g, "")}`;
  const eventIdRef = useRef(dropdownId);
  const selectedIndex = options.findIndex((option) => String(option.value) === String(value));
  const selected = selectedIndex >= 0 ? options[selectedIndex] : null;
  useEffect(() => {
    if (!open) return undefined;
    const close = (event) => {
      if (!ref.current?.contains(event.target) && !menuRef.current?.contains(event.target))
        setOpen(false);
    };
    const closeOnEscape = (event) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      ref.current?.querySelector("button")?.focus();
    };
    // Settings modals stop bubbling mouse events. Capture sees the click
    // before that handler, so an open dropdown always closes outside itself.
    document.addEventListener("pointerdown", close, true);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      document.removeEventListener("pointerdown", close, true);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);
  useEffect(() => {
    const closeWhenAnotherOpens = (event) => {
      if (event.detail !== eventIdRef.current) setOpen(false);
    };
    window.addEventListener("karaoke-dropdown-open", closeWhenAnotherOpens);
    return () => window.removeEventListener("karaoke-dropdown-open", closeWhenAnotherOpens);
  }, []);
  useLayoutEffect(() => {
    if (!open || !ref.current) return undefined;
    const updatePosition = () => {
      const rect = ref.current.getBoundingClientRect();
      const viewportGap = 12;
      const estimatedHeight = Math.min(320, options.length * 48 + 16);
      const spaceBelow = window.innerHeight - rect.bottom - viewportGap;
      const openUp = spaceBelow < estimatedHeight && rect.top > spaceBelow;
      setMenuStyle({
        position: "fixed",
        zIndex: 2000,
        left: `${rect.left}px`,
        top: openUp ? "auto" : `${rect.bottom + 6}px`,
        bottom: openUp ? `${window.innerHeight - rect.top + 6}px` : "auto",
        width: `${rect.width}px`,
        maxHeight: `${Math.max(120, Math.min(320, openUp ? rect.top - viewportGap : spaceBelow))}px`
      });
    };
    updatePosition();
    window.addEventListener("resize", updatePosition);
    window.addEventListener("scroll", updatePosition, true);
    return () => {
      window.removeEventListener("resize", updatePosition);
      window.removeEventListener("scroll", updatePosition, true);
    };
  }, [open, options.length]);
  const handleBlur = (event) => {
    if (!onBlur) return;
    const blurEvent = event;
    queueMicrotask(() => {
      const { activeElement } = document;
      if (ref.current?.contains(activeElement) || menuRef.current?.contains(activeElement)) {
        return;
      }
      onBlur(blurEvent);
    });
  };
  const handleTriggerKeyDown = (event) => {
    onKeyDown?.(event);
    if (event.defaultPrevented || disabled) return;
    if (["ArrowDown", "Enter", " "].includes(event.key)) {
      event.preventDefault();
      if (!open) {
        window.dispatchEvent(
          new CustomEvent("karaoke-dropdown-open", { detail: eventIdRef.current })
        );
        setOpen(true);
      }
    }
  };
  const toggle = () => {
    if (!open)
      window.dispatchEvent(
        new CustomEvent("karaoke-dropdown-open", { detail: eventIdRef.current })
      );
    setOpen((current) => !current);
  };
  return (
    <div className={`app-dropdown ${className}`} ref={ref}>
      <Button
        unstyled
        id={dropdownId}
        className="app-dropdown-trigger"
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={`${dropdownId}-menu`}
        aria-invalid={ariaInvalid}
        aria-describedby={ariaDescribedBy}
        onBlur={handleBlur}
        onKeyDown={handleTriggerKeyDown}
        onClick={toggle}
      >
        <span>{selected?.label || placeholder}</span>
        <ChevronDown size={15} aria-hidden="true" />
      </Button>
      {open &&
        menuStyle &&
        createPortal(
          <div
            ref={menuRef}
            id={`${dropdownId}-menu`}
            className="app-dropdown-menu app-dropdown-menu--portal"
            role="listbox"
            style={menuStyle}
          >
            {options.map((option) => {
              const isSelected = String(option.value) === String(value);
              return (
                <Button
                  unstyled
                  key={String(option.value)}
                  role="option"
                  aria-selected={isSelected}
                  className={`app-dropdown-option ${isSelected ? "is-selected" : ""}`}
                  onClick={(event) => {
                    event.stopPropagation();
                    setOpen(false);
                    onChange(option.value);
                    ref.current?.querySelector("button")?.focus();
                  }}
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      event.preventDefault();
                      setOpen(false);
                      ref.current?.querySelector("button")?.focus();
                    }
                  }}
                >
                  <span>{option.label}</span>
                  {isSelected && <Check size={15} aria-hidden="true" />}
                </Button>
              );
            })}
          </div>,
          document.body
        )}
    </div>
  );
}
