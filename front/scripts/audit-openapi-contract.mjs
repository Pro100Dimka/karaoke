// Cross-checks every literal API path called from src/api/domains/*.js
// against the backend's OpenAPI schema, without requiring TypeScript or a
// generated client. Catches two kinds of drift: a frontend call to a path
// the backend no longer serves (dead/broken code), and a backend endpoint no
// frontend code calls (candidate for removal or missing coverage).
import { parse } from "@babel/parser";
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { readdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(here, "../..");
const domainsDir = resolve(here, "../src/api/domains");
const CALLEE_NAMES = new Set(["request", "requestBlob", "createFileUrl"]);

function loadOpenApiSchema() {
  const venvPython = resolve(repoRoot, "backend/venv/Scripts/python.exe");
  const raw = execFileSync(
    venvPython,
    ["-c", "import json,sys; from app.main import app; json.dump(app.openapi(), sys.stdout)"],
    { cwd: resolve(repoRoot, "backend"), maxBuffer: 16 * 1024 * 1024, encoding: "utf8" }
  );
  return JSON.parse(raw);
}

// OpenAPI param segments are named ({song_id}); ours come from a template
// literal interpolation with no name attached. Structural equality only.
const PARAM = Symbol("param");
function segments(path) {
  return path
    .split("?")[0]
    .split("/")
    .filter(Boolean)
    .map((segment) => (segment.startsWith("{") || segment === "\0PARAM\0" ? PARAM : segment));
}
function samePath(a, b) {
  const left = segments(a);
  const right = segments(b);
  return left.length === right.length && left.every((segment, index) => segment === right[index]);
}

function literalPathFromNode(node) {
  if (node.type === "StringLiteral") return node.value;
  if (node.type === "TemplateLiteral") {
    // A ${...} that starts a fresh path segment (its preceding static text
    // ends in "/") is a path parameter -- e.g. `/songs/${id}/status`. One
    // glued onto existing segment text instead (`/cover${suffix}`) is a
    // query string or similar suffix in every call site this project has,
    // never a path segment, so the path ends there.
    let path = node.quasis[0].value.cooked;
    for (let index = 0; index < node.expressions.length; index += 1) {
      if (!path.endsWith("/")) break;
      path += "\0PARAM\0" + node.quasis[index + 1].value.cooked;
    }
    return path;
  }
  return null;
}

function methodFromArguments(args) {
  const options = args[1];
  if (!options || options.type !== "ObjectExpression") return "GET";
  const methodProperty = options.properties.find(
    (property) =>
      property.type === "ObjectProperty" &&
      ((property.key.type === "Identifier" && property.key.name === "method") ||
        (property.key.type === "StringLiteral" && property.key.value === "method"))
  );
  if (!methodProperty || methodProperty.value.type !== "StringLiteral") return "GET";
  return methodProperty.value.value.toUpperCase();
}

function extractCalls(source, file) {
  const ast = parse(source, { sourceType: "module", plugins: [] });
  const calls = [];
  (function walk(node) {
    if (!node || typeof node.type !== "string") return;
    if (
      node.type === "CallExpression" &&
      node.callee.type === "Identifier" &&
      CALLEE_NAMES.has(node.callee.name) &&
      node.arguments.length > 0
    ) {
      const path = literalPathFromNode(node.arguments[0]);
      if (path && path.startsWith("/")) {
        const method = node.callee.name === "createFileUrl" ? "GET" : methodFromArguments(node.arguments);
        calls.push({ path: path.split("?")[0], method: method.toLowerCase(), file });
      }
    }
    for (const key of Object.keys(node)) {
      if (key === "loc" || key === "start" || key === "end" || key === "range") continue;
      const value = node[key];
      if (Array.isArray(value)) value.forEach(walk);
      else if (value && typeof value.type === "string") walk(value);
    }
  })(ast.program);
  return calls;
}

async function collectFrontendCalls() {
  const files = (await readdir(domainsDir)).filter((name) => name.endsWith(".js"));
  const calls = [];
  for (const file of files) {
    const source = readFileSync(resolve(domainsDir, file), "utf8");
    calls.push(...extractCalls(source, file));
  }
  return calls;
}

function findBackendMatch(schemaPaths, call) {
  return schemaPaths.find(
    ({ path, methods }) => samePath(path, call.path) && methods.includes(call.method)
  );
}

const schema = loadOpenApiSchema();
const schemaPaths = Object.entries(schema.paths).map(([path, operations]) => ({
  path,
  methods: Object.keys(operations)
}));
const frontendCalls = await collectFrontendCalls();

const orphanedFrontendCalls = frontendCalls.filter((call) => !findBackendMatch(schemaPaths, call));
const calledBackendPaths = new Set();
for (const call of frontendCalls) {
  const match = findBackendMatch(schemaPaths, call);
  if (match) calledBackendPaths.add(`${match.path}#${call.method}`);
}
const uncalledBackendEndpoints = schemaPaths.flatMap(({ path, methods }) =>
  methods.filter((method) => !calledBackendPaths.has(`${path}#${method}`)).map((method) => `${method.toUpperCase()} ${path}`)
);

console.log(`Checked ${frontendCalls.length} frontend calls against ${schemaPaths.length} backend paths.`);

if (orphanedFrontendCalls.length > 0) {
  console.error("\nFrontend calls with no matching backend endpoint:");
  for (const call of orphanedFrontendCalls) {
    console.error(`  ${call.method.toUpperCase()} ${call.path.replace(/\0PARAM\0/g, "{param}")}  (${call.file})`);
  }
}

if (uncalledBackendEndpoints.length > 0) {
  console.log("\nBackend endpoints with no frontend caller in src/api/domains (informational):");
  for (const endpoint of uncalledBackendEndpoints) console.log(`  ${endpoint}`);
}

if (orphanedFrontendCalls.length > 0) {
  console.error(`\n${orphanedFrontendCalls.length} orphaned frontend call(s) found.`);
  process.exit(1);
}
console.log("\nNo orphaned frontend calls.");
