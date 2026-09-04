import { translateSaved as tr } from "../../../i18n/runtime";
import { ChevronDown, ChevronUp } from "lucide-react";
import { forwardRef, useRef } from "react";

import Button from "../Button";
import TextField from "../TextField";
import cx from "../_internal/cx";
import mergeRefs from "../_internal/mergeRefs";

import "./number-field.css";

const NumberField = forwardRef(function NumberField(
  {
    value,
    defaultValue,
    onChange,
    min,
    max,
    step = 1,
    disabled = false,
    readOnly = false,
    controls = true,
    className,
    inputClassName,
    ...props
  },
  ref
) {
  const inputRef = useRef(null);

  const changeBy = (direction) => {
    const input = inputRef.current;

    if (!input || disabled || readOnly) return;

    try {
      direction > 0 ? input.stepUp() : input.stepDown();
    } catch {
      const current = Number(input.value || 0);
      const amount = Number(step) || 1;
      let next = current + amount * direction;

      if (min != null) next = Math.max(Number(min), next);
      if (max != null) next = Math.min(Number(max), next);

      input.value = String(next);
    }

    onChange?.(input.value);
    input.focus();
  };

  const controlsSlot = controls ? (
    <span className="ui-number-field-controls" aria-hidden="true">
      <Button
        className="ui-number-field-step"
        unstyled
        size="sm"
        tabIndex={-1}
        disabled={disabled || readOnly}
        aria-label={tr("common.number.increase")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => changeBy(1)}
      >
        <ChevronUp />
      </Button>

      <Button
        className="ui-number-field-step"
        unstyled
        size="sm"
        tabIndex={-1}
        disabled={disabled || readOnly}
        aria-label={tr("common.number.decrease")}
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => changeBy(-1)}
      >
        <ChevronDown />
      </Button>
    </span>
  ) : null;

  return (
    <TextField
      {...props}
      ref={mergeRefs(ref, inputRef)}
      type="number"
      min={min}
      max={max}
      step={step}
      value={value}
      defaultValue={defaultValue}
      disabled={disabled}
      readOnly={readOnly}
      className={cx("ui-number-field", className)}
      inputClassName={cx("ui-number-field-input", inputClassName)}
      end={controlsSlot}
      onChange={onChange}
    />
  );
});

export default NumberField;
