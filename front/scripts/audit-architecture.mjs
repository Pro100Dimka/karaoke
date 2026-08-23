import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const root = process.cwd();
const src = path.join(root, "src");
const theme = path.join(src, "theme");
const files = [];
const violations = [];
const advisories = [];
const relative = (file) => path.relative(root, file).replaceAll("\\", "/");
// const extensions = /\.(?:js|jsx|ts|tsx|css)$/;
const audited = /\.(?:js|jsx)$/;

const walk = (directory) => {
  const entries = fs.readdirSync(directory, { withFileTypes: true });
  const dirs = entries.filter((x) => x.isDirectory());
  // const sources = entries.filter((x) => x.isFile() && extensions.test(x.name));
  // if (![src, theme].includes(directory) && !dirs.length && sources.length === 1) {
  //   violations.push(`single-file source directory must be flattened: ${relative(directory)}`);
  // }
  dirs
    .map((x) => path.join(directory, x.name))
    .filter((x) => x !== theme)
    .forEach(walk);

  entries
    .filter((x) => x.isFile() && audited.test(x.name))
    .map((x) => path.join(directory, x.name))
    .forEach((file) =>
      files.push({
        name: relative(file),
        text: fs.readFileSync(file, "utf8")
      })
    );
};
walk(src);
const projectChecks = [
  ...fs
    .readdirSync(root, { withFileTypes: true })
    .filter((x) => x.isDirectory() && x.name.startsWith("coverage-"))
    .map((x) => `legacy coverage directory must be consolidated: ${x.name}`),
  ...(fs.existsSync(path.join(root, "coverage", "coverage-final.json"))
    ? ["coverage/coverage-final.json must use a descriptive report name"]
    : [])
];

violations.push(...projectChecks);

const localStorageAllow = new Set([
  "src/utils/theme.js",
  "src/utils/language.js",
  "src/utils/storage.js",
  "src/pages/Karaoke/utils/preferences.js"
]);

const rules = [
  ["destructured catch parameter", /catch\s*\(\s*\{/],
  ["direct interpolation of unknown error.message", /\$\{\s*(?:err|error)\.message\s*\}/],
  ["javascript URL", /(?:href|src)\s*=\s*["']javascript:/i],
  ["placeholder hash link", /href\s*=\s*["']#["']/i]
];

for (const { name, text } of files) {
  violations.push(
    ...rules.filter(([, pattern]) => pattern.test(text)).map(([label]) => `${label}: ${name}`)
  );
  if (!localStorageAllow.has(name) && /(?:window\.|globalThis\.)?localStorage/.test(text)) {
    violations.push(`direct localStorage access: ${name}`);
  }

  if (
    name === "src/components/routes.jsx" &&
    (/key=\{(?:index|i)\}/.test(text) || !text.includes("key={path}"))
  ) {
    violations.push("routes must use stable path keys");
  }

  const lines = text.split(/\r?\n/).length;
  if (lines > 700) advisories.push(`${name}: ${lines} lines`);
}

const report = (title, items, method = "log") => {
  if (items.length) {
    console[method](`${title}:\n${items.map((x) => `- ${x}`).join("\n")}`);
  }
};

if (violations.length) {
  report("Architecture policy violations", violations, "error");
  process.exitCode = 1;
} else {
  console.log("Architecture policies: passed.");
}

report("Large-file advisories", advisories);
