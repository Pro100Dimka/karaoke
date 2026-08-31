import { translateSaved as tr } from "../../../i18n/runtime";
import { Check, ChevronDown } from "lucide-react";
import { Fragment, forwardRef, useEffect, useId, useRef, useState } from "react";
import { createPortal } from "react-dom";

import Button from "../Button";
import InputBase from "../InputBase";
import OutlinedInput from "../OutlinedInput";
import Popover from "../Popover";
import FloatingLabel from "../_internal/FloatingLabel";
import cx from "../_internal/cx";
import mergeRefs from "../_internal/mergeRefs";
import { optionItem } from "../_internal/option";
import mergeSx from "../_internal/sx";
import useControllable from "../_internal/useControllable";

import "./select.css";

const Select = forwardRef(
  (
    {
      id,
      label,
      hint,
      tooltip,
      error,
      required = false,
      disabled = false,
      size = "md",
      options = [],
      value,
      defaultValue,
      onChange,
      placeholder = tr("common.field.selectPlaceholder"),
      startIcon,
      endIcon,
      className = "",
      fieldClassName = "",
      sx,
      fieldSx,
      style,
      fullWidth,
      fieldStyle,
      ...props
    },
    ref
  ) => {
    const uid = useId().replace(/:/g, "");
    const triggerRef = useRef(null);
    const popoverRef = useRef(null);

    const [open, setOpen] = useState(false);
    const [position, setPosition] = useState(null);

    const [current, setCurrent] = useControllable(value, defaultValue, onChange);

    const normalizedOptions = options.map(optionItem);
    const selected = normalizedOptions.find((item) => String(item.value) === String(current));

    const controlId = id || `ui-select-${uid}`;
    const listboxId = `${controlId}-listbox`;
    const hintId = hint ? `${controlId}-hint` : undefined;
    const errorId = error ? `${controlId}-error` : undefined;

    const updatePosition = () => {
      const rect = triggerRef.current?.getBoundingClientRect();
      if (!rect) return;

      setPosition({
        top: rect.bottom + 6,
        left: rect.left,
        width: rect.width
      });
    };

    const close = () => setOpen(false);

    const toggle = () => {
      if (disabled) return;
      if (!open) updatePosition();
      setOpen((prev) => !prev);
    };

    const selectOption = (item, event) => {
      if (item.disabled) return;
      setCurrent(item.value, event);
      close();
      requestAnimationFrame(() => triggerRef.current?.focus());
    };

    const focusOption = (index) => {
      const buttons = popoverRef.current?.querySelectorAll(".ui-select-option:not(:disabled)");
      buttons?.[index]?.focus();
    };

    useEffect(() => {
      if (!open) return;

      updatePosition();

      const onPointerDown = (event) => {
        if (
          triggerRef.current?.contains(event.target) ||
          popoverRef.current?.contains(event.target)
        ) {
          return;
        }
        close();
      };

      const onViewportChange = () => updatePosition();

      document.addEventListener("pointerdown", onPointerDown, true);
      window.addEventListener("resize", onViewportChange);
      window.addEventListener("scroll", onViewportChange, true);

      return () => {
        document.removeEventListener("pointerdown", onPointerDown, true);
        window.removeEventListener("resize", onViewportChange);
        window.removeEventListener("scroll", onViewportChange, true);
      };
    }, [open]);

    useEffect(() => {
      if (!open) return;

      requestAnimationFrame(() => {
        const enabled = [
          ...(popoverRef.current?.querySelectorAll(".ui-select-option:not(:disabled)") || [])
        ];

        const selectedIndex = enabled.findIndex(
          (button) => button.dataset.value === String(current)
        );

        enabled[Math.max(0, selectedIndex)]?.focus();
      });
    }, [open, current]);

    const control = (fieldProps = {}) => {
      const { id: controlId, ...ariaProps } = fieldProps;

      return (
        <div className="ui-select-root">
          <OutlinedInput
            label={label}
            labelAccessory={Boolean(tooltip)}
            labelNode={
              <FloatingLabel id={controlId} label={label} required={required} tooltip={tooltip} />
            }
            required={required}
            disabled={disabled}
            error={!!error}
            size={size}
            className={cx("ui-select-field", className)}
            data-filled={Boolean(selected) || undefined}
            sx={sx}
            style={{ ...style, ...(fullWidth && { width: "100%" }) }}
          >
            <InputBase
              component={Button}
              ref={mergeRefs(triggerRef, ref)}
              id={controlId}
              type="button"
              unstyled
              size={size}
              className="ui-select-trigger ui-text-field-input"
              data-open={open || undefined}
              disabled={disabled}
              aria-haspopup="listbox"
              aria-expanded={open}
              aria-controls={open ? listboxId : undefined}
              onClick={toggle}
              onKeyDown={(event) => {
                if (disabled) return;

                if (
                  event.key === "ArrowDown" ||
                  event.key === "ArrowUp" ||
                  event.key === "Enter" ||
                  event.key === " "
                ) {
                  event.preventDefault();

                  if (!open) {
                    updatePosition();
                    setOpen(true);
                  }
                } else if (event.key === "Escape") {
                  close();
                }
              }}
              {...ariaProps}
              {...props}
            >
              {startIcon && (
                <span className="ui-select-start-icon" aria-hidden="true">
                  {startIcon}
                </span>
              )}

              <span className="ui-select-value" data-placeholder={!selected || undefined}>
                {selected?.label ?? placeholder}
              </span>

              <span className="ui-select-actions" aria-hidden="true">
                {endIcon && <span className="ui-select-end-icon">{endIcon}</span>}

                <ChevronDown className="ui-select-chevron" size={16} />
              </span>
            </InputBase>
          </OutlinedInput>

          {open &&
            position &&
            createPortal(
              <Popover
                ref={popoverRef}
                open
                portal={false}
                id={listboxId}
                role="listbox"
                className="ui-select-popover ui-control"
                data-size={size}
                style={{
                  position: "fixed",
                  top: position.top,
                  left: position.left,
                  width: position.width
                }}
                onKeyDown={(event) => {
                  const buttons = [
                    ...(popoverRef.current?.querySelectorAll(".ui-select-option:not(:disabled)") ||
                      [])
                  ];

                  const currentIndex = Math.max(0, buttons.indexOf(document.activeElement));

                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    focusOption((currentIndex + 1) % buttons.length);
                  } else if (event.key === "ArrowUp") {
                    event.preventDefault();
                    focusOption((currentIndex - 1 + buttons.length) % buttons.length);
                  } else if (event.key === "Home") {
                    event.preventDefault();
                    focusOption(0);
                  } else if (event.key === "End") {
                    event.preventDefault();
                    focusOption(buttons.length - 1);
                  } else if (event.key === "Escape") {
                    event.preventDefault();
                    close();
                    triggerRef.current?.focus();
                  } else if (event.key === "Tab") {
                    close();
                  }
                }}
              >
                <div className="ui-select-options">
                  {normalizedOptions.map((item, index) => {
                    const active = String(item.value) === String(current);
                    const showGroup =
                      item.group && item.group !== normalizedOptions[index - 1]?.group;

                    return (
                      <Fragment key={item.value}>
                        {showGroup && (
                          <div className="ui-select-group" role="presentation">
                            {item.group}
                          </div>
                        )}
                        <Button
                          type="button"
                          unstyled
                          data-size={size}
                          role="option"
                          aria-selected={active}
                          disabled={item.disabled}
                          data-value={String(item.value)}
                          data-selected={active || undefined}
                          className="ui-select-option ui-control"
                          onClick={(event) => selectOption(item, event)}
                        >
                          <span className="ui-select-option-mark">{active && <Check />}</span>

                          {item.icon && (
                            <span className="ui-select-option-icon" aria-hidden="true">
                              {item.icon}
                            </span>
                          )}

                          <span className="ui-select-option-content">
                            <span className="ui-select-option-label">{item.label}</span>

                            {item.description && (
                              <span className="ui-select-option-description">
                                {item.description}
                              </span>
                            )}
                          </span>
                        </Button>
                      </Fragment>
                    );
                  })}
                </div>
              </Popover>,
              document.body
            )}
        </div>
      );
    };

    const describedBy = [errorId, hintId].filter(Boolean).join(" ") || undefined;
    const rendered = control({ id: controlId, "aria-describedby": describedBy });
    if (!label && !hint && !error) return rendered;
    return (
      <div
        className={cx("ui-field", fieldClassName)}
        data-disabled={disabled || undefined}
        data-error={!!error || undefined}
        style={mergeSx(fieldSx, fieldStyle)}
      >
        {rendered}
        {error ? (
          <small id={errorId} className="ui-field-message" data-error>
            {error}
          </small>
        ) : hint ? (
          <small id={hintId} className="ui-field-message">
            {hint}
          </small>
        ) : null}
      </div>
    );
  }
);

Select.displayName = "Select";

export default Select;
