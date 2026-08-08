import fs from "node:fs";
import path from "node:path";

const root = process.cwd();
const sourceExtensions = new Set([".js", ".jsx", ".html"]);
const cssExtensions = new Set([".css"]);

function walk(directory, extensions) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath, extensions);
    return extensions.has(path.extname(entry.name)) ? [fullPath] : [];
  });
}

function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, "");
}

function selectorPreludes(css) {
  const source = stripComments(css);
  const preludes = [];
  let start = 0;
  let quote = null;
  let parentheses = 0;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];

    if (quote) {
      if (char === quote && source[index - 1] !== "\\") quote = null;
      continue;
    }

    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }

    if (char === "(") parentheses += 1;
    else if (char === ")") parentheses = Math.max(0, parentheses - 1);
    else if (char === "{" && parentheses === 0) {
      const prelude = source.slice(start, index).trim();
      if (
        prelude &&
        !prelude.startsWith("@") &&
        !/^(?:from|to|\d+(?:\.\d+)?%)$/i.test(prelude)
      ) {
        preludes.push(prelude);
      }
      start = index + 1;
    } else if (char === "}" && parentheses === 0) {
      start = index + 1;
    }
  }

  return preludes;
}

const cssFiles = walk(path.join(root, "src"), cssExtensions);
const sourceFiles = walk(path.join(root, "src"), sourceExtensions);
const source = sourceFiles
  .map((file) => fs.readFileSync(file, "utf8"))
  .join("\n");
const candidates = new Map();
const selectorPattern = /\.([_a-zA-Z]+[_a-zA-Z0-9-]*)/g;

for (const file of cssFiles) {
  const css = fs.readFileSync(file, "utf8");
  for (const prelude of selectorPreludes(css)) {
    for (const match of prelude.matchAll(selectorPattern)) {
      const className = match[1];
      if (!candidates.has(className)) candidates.set(className, new Set());
      candidates.get(className).add(path.relative(root, file));
    }
  }
}

const dynamicPrefixes = [
  "is-",
  "has-",
  "theme-",
  "status-",
  "badge-",
  "cosmic-",
  "karaoke-theme-",
  "karaoke-atmosphere-",
  "karaoke-flight-",
  "library-song-card--"
];

const unused = [...candidates]
  .filter(([className]) => !source.includes(className))
  .filter(
    ([className]) =>
      !dynamicPrefixes.some((prefix) => className.startsWith(prefix))
  )
  .sort(([a], [b]) => a.localeCompare(b));

console.log(`CSS classes found: ${candidates.size}`);
console.log(`Static unused candidates: ${unused.length}`);
if (unused.length) {
  console.log("Review only; no selectors are deleted automatically:");
  for (const [className, files] of unused.slice(0, 100)) {
    console.log(`- .${className} (${[...files].join(", ")})`);
  }
}
