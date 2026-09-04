const fs = require("fs");
const path = require("path");

// Use the same palette asset as the renderer, including in packaged builds.
function readThemeBackgrounds(
  css = fs.readFileSync(path.join(__dirname, "..", "src", "theme", "palettes.css"), "utf8")
) {
  const backgrounds = {};
  for (const [, selectors, declarations] of css.matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    const color = declarations.match(/--color-bg:\s*(#[\da-f]+)\s*;/i)?.[1];
    if (!color) continue;
    for (const [, theme] of selectors.matchAll(/data-theme=["']([^"']+)["']/g))
      backgrounds[theme] = color;
    if (selectors.includes(":root")) backgrounds.dark ??= color;
  }
  if (!backgrounds.dark) throw new Error("Theme palette is missing its default background");
  return backgrounds;
}

module.exports = { readThemeBackgrounds };
