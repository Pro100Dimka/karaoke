import { useState } from "react";

export default function useControllable(value, defaultValue, onChange) {
  const controlled = value !== undefined;
  const [internal, setInternal] = useState(defaultValue);
  const current = controlled ? value : internal;

  const set = (next, event) => {
    const resolved = typeof next === "function" ? next(current) : next;
    if (!controlled) setInternal(resolved);
    onChange?.(resolved, event);
    return resolved;
  };

  return [current, set];
}
