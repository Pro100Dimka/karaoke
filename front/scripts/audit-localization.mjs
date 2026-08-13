import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const root = process.cwd();
const sourceRoot = path.join(root, "src");
const baselinePath = path.join(root, "scripts", "localization-baseline.json");
const cyrillic = /[\u0400-\u04ff]/u;
const excluded = [
  `${path.sep}theme${path.sep}`,
  `${path.sep}i18n${path.sep}index.jsx`,
  `${path.sep}api${path.sep}mock${path.sep}`
];

const sourceFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:js|jsx|cjs|mjs)$/u.test(entry.name) ? [absolute] : [];
  });

const violationsFor = (file) => {
  const ast = parse(fs.readFileSync(file, "utf8"), {
    sourceType: "module",
    plugins: ["jsx"]
  });
  const violations = [];
  const record = (node, value) => {
    if (cyrillic.test(value)) violations.push(node.loc?.start.line ?? 1);
  };
  traverse(ast, {
    StringLiteral: ({ node, parent }) => {
      if (
        parent.type === "CallExpression" &&
        parent.callee.type === "Identifier" &&
        parent.callee.name === "translateSaved"
      )
        return;
      record(node, node.value);
    },
    TemplateElement: ({ node }) => record(node, node.value.raw),
    JSXText: ({ node }) => record(node, node.value)
  });
  return violations;
};

const current = Object.fromEntries(
  sourceFiles(sourceRoot)
    .filter((file) => !excluded.some((fragment) => file.includes(fragment)))
    .map((file) => [
      path.relative(root, file).replaceAll("\\", "/"),
      violationsFor(file)
    ])
    .filter(([, lines]) => lines.length)
    .map(([file, lines]) => [file, lines.length])
);

if (process.argv.includes("--print-baseline")) {
  console.log(JSON.stringify(current, null, 2));
  process.exit(0);
}

const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
const regressions = Object.entries(current).filter(
  ([file, count]) => count > (baseline[file] ?? 0)
);
const remaining = Object.values(current).reduce((sum, count) => sum + count, 0);
console.log(
  `Localization audit: ${remaining} legacy literals in ${Object.keys(current).length} files.`
);
if (regressions.length) {
  for (const [file, count] of regressions) {
    console.error(`${file}: ${count} (baseline ${baseline[file] ?? 0})`);
  }
  process.exit(1);
}
console.log("No new unlocalized production strings.");
