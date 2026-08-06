import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const IMPORT_PATTERN = /@import\s+["']([^"']+)["']\s*;/g;

export function readCssBundle(entryFiles) {
  const visited = new Set();

  function readFile(filePath) {
    const absolutePath = path.resolve(
      filePath instanceof URL ? fileURLToPath(filePath) : filePath
    );
    if (visited.has(absolutePath)) return "";
    visited.add(absolutePath);

    const source = fs.readFileSync(absolutePath, "utf8");
    const directory = path.dirname(absolutePath);
    const imports = [...source.matchAll(IMPORT_PATTERN)]
      .map((match) => match[1])
      .filter((importPath) => !/^(?:https?:|url\()/i.test(importPath))
      .map((importPath) => readFile(path.resolve(directory, importPath)))
      .join("\n");

    return `${imports}\n${source}`;
  }

  return entryFiles.map(readFile).join("\n");
}
