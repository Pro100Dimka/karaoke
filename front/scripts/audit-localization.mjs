import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
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
  `${path.sep}i18n${path.sep}messages-`,
  `${path.sep}api${path.sep}mock${path.sep}`
];

const sourceFiles = (directory) =>
  fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) return sourceFiles(absolute);
    return /\.(?:js|jsx|cjs|mjs)$/u.test(entry.name) ? [absolute] : [];
  });

export const violationsFor = (file) => {
  const ast = parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx"] });
  const translatedParameters = new Map();
  const directlyTranslated = (nodePath) => {
    const callPath = nodePath.parentPath;
    return (
      callPath.isCallExpression() &&
      callPath.node.callee.type === "Identifier" &&
      callPath.node.callee.name === "translateSaved" &&
      callPath.node.arguments[0] === nodePath.node
    );
  };
  traverse(ast, {
    Function(functionPath) {
      const parent = functionPath.parentPath;
      const name = functionPath.node.id?.name ?? parent.node.id?.name;
      if (!name) return;
      functionPath.node.params.forEach((parameter, index) => {
        if (parameter.type !== "Identifier") return;
        const references = functionPath.scope.getBinding(parameter.name)?.referencePaths;
        if (references?.length && references.every(directlyTranslated))
          translatedParameters.set(name, index);
      });
    }
  });
  const violations = [];
  const record = (node, value) => {
    if (cyrillic.test(value)) violations.push(node.loc?.start.line ?? 1);
  };
  const translatedArgument = (nodePath) => {
    if (directlyTranslated(nodePath)) return true;
    const callPath = nodePath.parentPath;
    if (!callPath.isCallExpression()) return false;
    const { arguments: callArguments } = callPath.node;
    const index = callArguments.indexOf(nodePath.node);
    const callee = callPath.node.callee;
    return callee.type === "Identifier" && translatedParameters.get(callee.name) === index;
  };
  const translatedConstant = (literalPath) => {
    const declaration = literalPath.parentPath;
    if (!declaration.isVariableDeclarator() || declaration.node.id.type !== "Identifier")
      return false;
    const references = declaration.scope.getBinding(declaration.node.id.name)?.referencePaths;
    return Boolean(references?.length && references.every(translatedArgument));
  };
  traverse(ast, {
    StringLiteral(literalPath) {
      if (translatedArgument(literalPath) || translatedConstant(literalPath)) return;
      record(literalPath.node, literalPath.node.value);
    },
    TemplateElement: ({ node }) => record(node, node.value.raw),
    JSXText: ({ node }) => record(node, node.value)
  });
  return violations;
};

export const runLocalizationAudit = () => {
  const current = Object.fromEntries(
    sourceFiles(sourceRoot)
      .filter((file) => !excluded.some((fragment) => file.includes(fragment)))
      .map((file) => [path.relative(root, file).replaceAll("\\", "/"), violationsFor(file)])
      .filter(([, lines]) => lines.length)
      .map(([file, lines]) => [file, lines.length])
  );
  if (process.argv.includes("--print-baseline")) {
    console.log(JSON.stringify(current, null, 2));
    return;
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
    process.exitCode = 1;
    return;
  }
  console.log("No new unlocalized production strings.");
};

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url)
  runLocalizationAudit();
