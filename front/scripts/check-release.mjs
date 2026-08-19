import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const packageJson = JSON.parse(fs.readFileSync(path.join(root, "package.json"), "utf8"));
const failures = [];

function requireText(value, label) {
  if (typeof value !== "string" || !value.trim()) failures.push(`${label} is missing`);
}

requireText(packageJson.name, "package.name");
requireText(packageJson.version, "package.version");
requireText(packageJson.description, "package.description");
requireText(packageJson.main, "package.main");

for (const requiredPath of ["src", "electron", "index.html", packageJson.main].filter(Boolean)) {
  if (!fs.existsSync(path.join(root, requiredPath))) failures.push(`Missing ${requiredPath}`);
}

const suspiciousPatterns = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /(?:api[_-]?key|secret|token)\s*[:=]\s*["'][^"']{16,}["']/i
];
const scanExtensions = [".js", ".jsx", ".cjs", ".mjs", ".json", ".env"];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (["node_modules", "dist", "release", ".git", ".stryker-tmp"].includes(entry.name)) return [];
    const fullPath = path.join(directory, entry.name);
    return entry.isDirectory() ? walk(fullPath) : [fullPath];
  });
}

for (const file of walk(root).filter((item) => scanExtensions.includes(path.extname(item)))) {
  const content = fs.readFileSync(file, "utf8");
  if (suspiciousPatterns.some((pattern) => pattern.test(content))) {
    failures.push(`Possible secret in ${path.relative(root, file)}`);
  }
}

if (failures.length) {
  console.error("Release metadata check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const result = spawnSync(command, ["run", "verify"], { cwd: root, stdio: "inherit", shell: true });
process.exit(result.status ?? 1);
