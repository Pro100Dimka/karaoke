import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";

const traverse = traverseModule.default ?? traverseModule;
const root = path.resolve("src");
const findings = [];
const extensions = [".js", ".jsx"];

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) return entry.name === "theme" ? [] : walk(file);
    return extensions.includes(path.extname(file)) ? [file] : [];
  });
}

const report = (file, node, kind, detail) =>
  findings.push({
    file: path.relative(process.cwd(), file).replaceAll("\\", "/"),
    line: node.loc?.start.line ?? 1,
    kind,
    detail
  });

const flattenLogical = (node, operator) =>
  node?.type === "LogicalExpression" && node.operator === operator
    ? [...flattenLogical(node.left, operator), ...flattenLogical(node.right, operator)]
    : [node];

for (const file of walk(root)) {
  const source = fs.readFileSync(file, "utf8");
  let ast;
  try {
    ast = parse(source, {
      sourceType: "module",
      plugins: ["jsx", "classProperties", "optionalChaining"]
    });
  } catch {
    continue;
  }

  traverse(ast, {
    SwitchStatement(pathRef) {
      const count = pathRef.node.cases.length;
      if (count >= 4) report(file, pathRef.node, "dispatch-table", `${count} switch branches`);
    },
    IfStatement(pathRef) {
      let depth = 0;
      for (let parent = pathRef.parentPath; parent; parent = parent.parentPath)
        if (parent.isIfStatement()) depth += 1;
      if (depth >= 2) report(file, pathRef.node, "guard-clause", `nested if depth ${depth + 1}`);
    },
    LogicalExpression(pathRef) {
      if (pathRef.parentPath.isLogicalExpression({ operator: pathRef.node.operator })) return;
      const expressions = flattenLogical(pathRef.node, pathRef.node.operator);
      const comparisons = expressions.filter(({ type }) => type === "BinaryExpression");
      if (pathRef.node.operator === "||" && comparisons.length >= 3)
        report(file, pathRef.node, "membership", `${comparisons.length} OR comparisons`);
    },
    CallExpression(pathRef) {
      if (
        pathRef.node.callee.type === "Identifier" &&
        pathRef.node.callee.name === "useState" &&
        ["BooleanLiteral"].includes(pathRef.node.arguments[0]?.type)
      )
        report(file, pathRef.node, "state-model", "boolean useState candidate");
    },
    Function(pathRef) {
      const { body } = pathRef.node;
      if (
        body?.type === "BlockStatement" &&
        body.body.length === 1 &&
        body.body[0].type === "ReturnStatement" &&
        body.body[0].argument?.type === "CallExpression"
      )
        report(file, pathRef.node, "wrapper", "single-call forwarding function");
    }
  });
}

const groups = Object.groupBy(findings, ({ kind }) => kind);
console.log("Semantic simplification audit (advisory):");
console.log(`Candidates: ${findings.length}`);
Object.entries(groups).forEach(([kind, items]) => console.log(`- ${kind}: ${items.length}`));
findings
  .slice(0, 40)
  .forEach(({ file, line, kind, detail }) => console.log(`  ${file}:${line} [${kind}] ${detail}`));
if (findings.length > 40) console.log(`  ...and ${findings.length - 40} more`);
