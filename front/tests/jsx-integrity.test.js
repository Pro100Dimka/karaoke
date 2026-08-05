import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const srcRoot = path.join(root, "src");

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? walk(full) : [full];
  });
}

const jsxFiles = walk(srcRoot).filter((file) => file.endsWith(".jsx"));

function extractOpeningTags(source) {
  const tags = [];
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] !== "<" || !/[A-Za-z]/.test(source[index + 1] ?? ""))
      continue;
    let cursor = index + 1;
    let quote = null;
    let braceDepth = 0;
    while (cursor < source.length) {
      const char = source[cursor];
      if (quote) {
        if (char === quote && source[cursor - 1] !== "\\") quote = null;
      } else if (char === '"' || char === "'") {
        quote = char;
      } else if (char === "{") {
        braceDepth += 1;
      } else if (char === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
      } else if (char === ">" && braceDepth === 0) {
        tags.push(source.slice(index, cursor + 1));
        index = cursor;
        break;
      }
      cursor += 1;
    }
  }
  return tags;
}

function duplicateAttributes(tag) {
  const withoutExpressions = tag.replace(/\{(?:[^{}]|\{[^{}]*\})*\}/gs, " ");
  const body = withoutExpressions.replace(/^<\S+/, "").replace(/\/?\s*>$/, "");
  const attributes = [
    ...body.matchAll(/(?:^|\s)([A-Za-z_:][\w:.-]*)\s*(?==|\s|$)/g)
  ].map((match) => match[1]);
  return [
    ...new Set(
      attributes.filter((name, index) => attributes.indexOf(name) !== index)
    )
  ];
}

function importedAndDeclaredNames(source) {
  const names = new Set(["Fragment"]);

  for (const statement of source.matchAll(
    /import[\s\S]*?from\s+["'][^"']+["'];?/g
  )) {
    const text = statement[0];
    const defaultImport = text.match(/^import\s+([A-Z]\w*)/);
    if (defaultImport) names.add(defaultImport[1]);
    const named = text.match(/\{([\s\S]*?)\}/);
    if (named) {
      for (const part of named[1].split(",")) {
        const clean = part.trim();
        if (!clean) continue;
        const alias = clean
          .split(/\s+as\s+/)
          .at(-1)
          ?.trim();
        if (alias) names.add(alias);
      }
    }
  }

  for (const match of source.matchAll(/(?:function|class)\s+([A-Z]\w*)/g))
    names.add(match[1]);
  for (const match of source.matchAll(/const\s+([A-Z]\w*)\s*=/g))
    names.add(match[1]);

  for (const destructuring of source.matchAll(/\{([^{}]*?)\}/g)) {
    for (const token of destructuring[1].matchAll(/\b([A-Z]\w*)\b/g)) {
      names.add(token[1]);
    }
  }

  for (const destructuring of source.matchAll(/\(\s*\[([^\]]+)\]\s*\)\s*=>/g)) {
    for (const token of destructuring[1].matchAll(/\b([A-Z]\w*)\b/g)) {
      names.add(token[1]);
    }
  }

  return names;
}

for (const file of jsxFiles) {
  const relative = path.relative(root, file);
  const source = fs.readFileSync(file, "utf8");

  test(`${relative} has no duplicate JSX attributes`, () => {
    const duplicates = extractOpeningTags(source).flatMap((tag) =>
      duplicateAttributes(tag).map((name) => `${name} in ${tag.slice(0, 120)}`)
    );
    assert.deepEqual(duplicates, []);
  });

  test(`${relative} resolves capitalized JSX identifiers`, () => {
    const known = importedAndDeclaredNames(source);
    const used = [...source.matchAll(/<([A-Z]\w*)\b/g)].map(
      (match) => match[1]
    );
    const unresolved = [...new Set(used.filter((name) => !known.has(name)))];
    assert.deepEqual(unresolved, []);
  });
}

test("application JSX contains no duplicate type attributes", () => {
  const offenders = [];
  for (const file of jsxFiles) {
    const source = fs.readFileSync(file, "utf8");
    for (const tag of extractOpeningTags(source)) {
      if (duplicateAttributes(tag).includes("type")) {
        offenders.push(path.relative(root, file));
      }
    }
  }
  assert.deepEqual(offenders, []);
});
