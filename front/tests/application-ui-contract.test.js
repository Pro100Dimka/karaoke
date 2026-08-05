import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const root = join(testsDir, "..");
const srcRoot = join(root, "src");
const walk = (dir, extension) =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? walk(path, extension)
      : path.endsWith(extension)
        ? [path]
        : [];
  });
const jsxFiles = walk(srcRoot, ".jsx");
const cssFiles = walk(srcRoot, ".css");
const css = cssFiles.map((path) => readFileSync(path, "utf8")).join("\n");
const getOpeningTags = (source, tagName) => {
  const tags = [];
  const opening = `<${tagName}`;
  let searchFrom = 0;
  let start = source.indexOf(opening, searchFrom);
  while (start !== -1) {
    let index = start + opening.length;
    let quote = null;
    let braces = 0;
    let tagEnd = -1;
    while (index < source.length && tagEnd === -1) {
      const char = source[index];
      const previousChar = source[index - 1];
      if (quote) {
        if (char === quote && previousChar !== "\\") quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "{") {
        braces += 1;
      } else if (char === "}") {
        braces = Math.max(0, braces - 1);
      } else if (char === ">" && braces === 0) {
        tagEnd = index;
      }

      index += 1;
    }

    if (tagEnd !== -1) {
      tags.push(source.slice(start, tagEnd + 1));
      searchFrom = tagEnd + 1;
    } else {
      searchFrom = start + opening.length;
    }

    start = source.indexOf(opening, searchFrom);
  }

  return tags;
};

for (const path of jsxFiles) {
  const source = readFileSync(path, "utf8");
  const name = relative(srcRoot, path);

  test(`${name}: native buttons declare type`, () => {
    const buttons = getOpeningTags(source, "button");
    const missing = buttons.filter((button) => !/\btype=/.test(button));
    assert.deepEqual(missing, []);
  });

  test(`${name}: no javascript URLs`, () => {
    assert.equal(/href\s*=\s*["']javascript:/i.test(source), false);
  });

  test(`${name}: no empty href navigation`, () => {
    assert.equal(/href\s*=\s*["'](?:#|)["']/.test(source), false);
  });

  test(`${name}: no duplicated aria-label attribute in one tag`, () => {
    const tags = [...source.matchAll(/<[^>]+>/g)].map((match) => match[0]);
    const invalid = tags.filter(
      (tag) => (tag.match(/\baria-label=/g) || []).length > 1
    );
    assert.deepEqual(invalid, []);
  });

  test(`${name}: icon-only buttons have an accessible label or title`, () => {
    const buttons = [
      ...source.matchAll(/<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g)
    ];
    const invalid = buttons.filter(([, attrs, body]) => {
      const text = body
        .replace(/<[^>]+>/g, "")
        .replace(/\{[^}]+\}/g, "")
        .trim();
      const hasTextContainer = /<(?:span|strong|small|p|div)\b/.test(body);
      const hasDynamicText =
        /\{(?:children|text|title|label|selected[^}]*)\}/.test(body) ||
        /\{[^}]*\?[^}]*:[^}]*\}/.test(body);
      const iconOnly =
        !text &&
        !hasTextContainer &&
        !hasDynamicText &&
        /<[A-Z][A-Za-z0-9]*/.test(body);
      return iconOnly && !/aria-label=|title=/.test(attrs);
    });
    assert.deepEqual(
      invalid.map((match) => match[0]),
      []
    );
  });

  test(`${name}: static class names have CSS coverage`, () => {
    const classNames = [...source.matchAll(/className\s*=\s*["']([^"']+)["']/g)]
      .flatMap((match) => match[1].split(/\s+/))
      .filter(Boolean);
    const missing = classNames.filter((className) => {
      const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      if (new RegExp(`\\.${escaped}(?![\\w-])`).test(css)) return false;
      const base = className.includes("--") ? className.split("--")[0] : null;
      return !base || !new RegExp(`\\.${base}(?![\\w-])`).test(css);
    });
    assert.deepEqual([...new Set(missing)], []);
  });
}
