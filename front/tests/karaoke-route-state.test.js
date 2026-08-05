import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync("src/pages/Karaoke/index.jsx", "utf8");

test("Karaoke follows route songId updates instead of freezing initial navigation state", () => {
  assert.match(source, /const songId = location\.state\?\.songId \|\| null;/);
  assert.doesNotMatch(source, /useState\(location\.state\?\.songId/);
});
