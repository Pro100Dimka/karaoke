import fs from "node:fs";
import path from "node:path";
import { parse } from "@babel/parser";
import traverseModule from "@babel/traverse";
import { expect, test } from "vitest";
import { messages } from "../src/i18n/messages";

const traverse = traverseModule.default ?? traverseModule;
const root = path.resolve("src");
const files = (dir) =>
  fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(dir, entry.name);
    return entry.isDirectory() ? files(file) : /\.(js|jsx)$/.test(file) ? [file] : [];
  });

test("production translations only use existing named keys, never source-language literals", () => {
  const problems = [];
  for (const file of files(root).filter((file) => !/[\\/]i18n[\\/]|[\\/]mock[\\/]/.test(file))) {
    const code = fs.readFileSync(file, "utf8");
    if (!code.includes("i18n")) continue;
    const ast = parse(code, { sourceType: "module", plugins: ["jsx"] });
    traverse(ast, {
      CallExpression(p) {
        if (!["t", "tr", "translateSaved", "translate"].includes(p.node.callee.name)) return;
        const argument = p.get("arguments.0");
        if (!argument?.node) return;
        const check = (node) => {
          if (!(node.value in messages.ru)) problems.push(`${path.relative(root, file)}:${node.loc.start.line} ${node.value}`);
        };
        const checkValue = (node) => {
          if (node.type === "StringLiteral") check(node);
          else if (node.type === "ConditionalExpression") {
            checkValue(node.consequent);
            checkValue(node.alternate);
          } else if (node.type === "LogicalExpression") {
            checkValue(node.left);
            checkValue(node.right);
          }
        };
        checkValue(argument.node);
      }
    });
  }
  expect(problems).toEqual([]);
});

test("the source-text catalog is absent and cannot be reintroduced through imports", () => {
  const legacy = "source-messages.json";
  expect(fs.existsSync(path.join(root, "i18n", legacy))).toBe(false);
  for (const file of files(root)) expect(fs.readFileSync(file, "utf8")).not.toContain(legacy);
});

test("UI source-language text belongs in catalogs, including dynamic row descriptors", () => {
  const problems = [];
  for (const file of files(root).filter((file) => !/[\\/]i18n[\\/]|[\\/]mock[\\/]/.test(file))) {
    const record = (node, value) => {
      if (/[\u0400-\u04ff]/u.test(value))
        problems.push(`${path.relative(root, file)}:${node.loc.start.line}`);
    };
    traverse(parse(fs.readFileSync(file, "utf8"), { sourceType: "module", plugins: ["jsx"] }), {
      StringLiteral: ({ node }) => record(node, node.value),
      JSXText: ({ node }) => record(node, node.value),
      TemplateElement: ({ node }) => record(node, node.value.raw)
    });
  }
  expect(problems).toEqual([]);
});
