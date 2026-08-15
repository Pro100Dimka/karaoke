import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const roots = ["electron", "scripts"];
const extensions = [".cjs", ".mjs", ".js"];
const files = [];

function walk(directory) {
  if (!fs.existsSync(directory)) return;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) walk(fullPath);
    else if (extensions.includes(path.extname(entry.name))) files.push(fullPath);
  }
}

for (const root of roots) walk(root);

for (const file of files.sort()) {
  execFileSync(process.execPath, ["--check", file], { stdio: "pipe" });
}

console.log(`Syntax checks passed for ${files.length} Node/Electron files.`);
