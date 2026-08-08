import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import test from "node:test";

export const root = resolve(import.meta.dirname, "../..");
export const sourcePath = (path) => join(root, path);
export const readSource = (path) => readFileSync(sourcePath(path), "utf8");

export function listFiles(path, options = {}) {
  const { extensions } = options;
  const files = [];
  const walk = (directory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const file = join(directory, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (!extensions || extensions.some((ext) => file.endsWith(ext)))
        files.push(file);
    }
  };
  walk(sourcePath(path));
  return files;
}

export const relativeToRoot = (path) =>
  relative(root, path).replaceAll("\\", "/");

export function sourceContract(
  name,
  path,
  { includes = [], excludes = [], count = [] }
) {
  test(name, () => {
    const source = readSource(path);
    for (const pattern of includes) assert.match(source, pattern);
    for (const pattern of excludes) assert.doesNotMatch(source, pattern);
    for (const [pattern, expected] of count) {
      assert.equal((source.match(pattern) || []).length, expected);
    }
  });
}

export function multiSourceContract(name, files, verify) {
  test(name, () =>
    verify(Object.fromEntries(files.map((path) => [path, readSource(path)])))
  );
}
