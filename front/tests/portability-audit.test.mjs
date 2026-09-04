import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { test } from "vitest";

test("portability audit follows the extracted backend process boundary", () => {
  const output = execFileSync(process.execPath, ["scripts/audit-portability.mjs"], {
    encoding: "utf8",
  });
  assert.equal(output, "");
});
