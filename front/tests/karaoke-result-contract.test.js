import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { shouldLoadKaraokeResult } from "../src/pages/Karaoke/utils/result.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("shouldLoadKaraokeResult accepts only completed songs with an id", () => {
  assert.equal(shouldLoadKaraokeResult({ id: "1", status: "done" }), true);
  assert.equal(shouldLoadKaraokeResult({ id: "", status: "done" }), false);
  assert.equal(
    shouldLoadKaraokeResult({ id: "1", status: "processing" }),
    false
  );
  assert.equal(shouldLoadKaraokeResult(null), false);
});

test("Karaoke delegates result loading to the result hook", () => {
  const source = fs.readFileSync(
    path.join(root, "src/pages/Karaoke/index.jsx"),
    "utf8"
  );
  assert.match(source, /useKaraokeResult\(song\)/);
  assert.doesNotMatch(source, /api\s*\.\s*getResult/);
});
