const kebab = (value) =>
  value.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`);

function writeVars(style, value, path = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => writeVars(style, item, [...path, index]));
    return;
  }

  if (value && typeof value === "object") {
    Object.entries(value).forEach(([key, item]) =>
      writeVars(style, item, [...path, key])
    );
    return;
  }

  style.setProperty(`--${path.map(kebab).join("-")}`, String(value));
}

export default function createTheme(
  config,
  root = typeof document === "undefined" ? null : document.documentElement
) {
  if (!root) return config;
  writeVars(root.style, config);
  root.style.colorScheme = config.palette?.mode || "dark";
  return config;
}
