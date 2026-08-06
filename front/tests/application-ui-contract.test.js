import assert from "node:assert/strict";
import test from "node:test";
import { listFiles, readSource, relativeToRoot } from "./helpers/project.js";
import { openingTags } from "./helpers/source-analysis.js";

const jsxFiles = listFiles("src", { extensions: [".jsx"] });
const css = listFiles("src", { extensions: [".css"] })
  .map((file) => readSource(relativeToRoot(file)))
  .join("\n");

for (const file of jsxFiles) {
  const source = readSource(relativeToRoot(file));
  const name = relativeToRoot(file).replace(/^src\//, "");
  const checks = [
    ["native buttons declare type", () => openingTags(source, "button").filter((tag) => !/\btype=/.test(tag))],
    ["no javascript URLs", () => (/href\s*=\s*["']javascript:/i.test(source) ? [true] : [])],
    ["no empty href navigation", () => (/href\s*=\s*["'](?:#|)["']/.test(source) ? [true] : [])],
    ["no duplicated aria-label", () => openingTags(source).filter((tag) => (tag.match(/\baria-label=/g) || []).length > 1)],
    ["icon buttons are named", () => [...source.matchAll(/<button\b([\s\S]*?)>([\s\S]*?)<\/button>/g)].filter(([, attrs, body]) => {
      const text = body.replace(/<[^>]+>/g, "").replace(/\{[^}]+\}/g, "").trim();
      const dynamic = /<(?:span|strong|small|p|div)\b|\{(?:children|text|title|label|selected[^}]*)\}|\{[^}]*\?[^}]*:[^}]*\}/.test(body);
      return !text && !dynamic && /<[A-Z][A-Za-z0-9]*/.test(body) && !/aria-label=|title=/.test(attrs);
    })],
    ["static classes have CSS", () => [...new Set([...source.matchAll(/className\s*=\s*["']([^"']+)["']/g)]
      .flatMap((match) => match[1].split(/\s+/)).filter(Boolean).filter((className) => {
        const escaped = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        if (new RegExp(`\\.${escaped}(?![\\w-])`).test(css)) return false;
        const base = className.includes("--") ? className.split("--")[0] : null;
        return !base || !new RegExp(`\\.${base}(?![\\w-])`).test(css);
      }))]]
  ];
  for (const [label, findInvalid] of checks) {
    test(`${name}: ${label}`, () => assert.deepEqual(findInvalid(), []));
  }
}
