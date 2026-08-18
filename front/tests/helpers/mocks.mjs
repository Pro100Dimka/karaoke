import { createElement } from "react";

// A passthrough mock for a theme/ui primitive: keeps its children/props but
// renders as a plain DOM tag, so component tests can query real DOM nodes
// without pulling in the actual themed implementation.
export const passthrough = (tag) => {
  const Component = ({ children, ...props }) => createElement(tag, props, children);
  return Component;
};

// Matches src/i18n's real `t(key, values, fallback)` contract closely enough
// for component tests: returns the fallback string when given one, else the
// raw key.
export const mockUseI18nWithFallback = () => ({
  t: (key, _values, fallback) => fallback || key
});

// Variant used by tests that assert on interpolated values rather than a
// fallback string: renders as `key:value1,value2`.
export const mockUseI18nWithValues = () => ({
  t: (key, values) => (values ? `${key}:${Object.values(values).join(",")}` : key)
});
