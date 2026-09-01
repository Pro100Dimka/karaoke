import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "vitest";


test("changing one byte invalidates an otherwise unchanged build step", () => {
  const builder = fs.readFileSync("../scripts/build-installer.ps1", "utf8");
  const start = builder.indexOf("function Get-StatePath");
  const end = builder.indexOf("function Migrate-StateIfCompatible", start);
  assert.ok(start >= 0 && end > start);

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "advoice-cache-test-"));
  const scriptPath = path.join(root, "test.ps1");
  const state = path.join(root, "state").replaceAll("'", "''");
  const output = path.join(root, "artifact.bin").replaceAll("'", "''");
  const harness = `
$ErrorActionPreference = "Stop"
$StateDir = '${state}'
$script:StepRequiredOutputs = @{}
${builder.slice(start, end)}
$artifact = '${output}'
[IO.File]::WriteAllBytes($artifact, [byte[]](1,2,3,4))
if (-not (Test-StepNeeded "fixture" "input-hash" @($artifact))) { throw "missing state was accepted" }
Set-State "fixture" "input-hash"
if (Test-StepNeeded "fixture" "input-hash" @($artifact)) { throw "valid output was rejected" }
[IO.File]::WriteAllBytes($artifact, [byte[]](1,2,3,5))
if (-not (Test-StepNeeded "fixture" "input-hash" @($artifact))) { throw "changed byte was accepted" }
`;
  fs.writeFileSync(scriptPath, harness);
  try {
    const result = spawnSync("powershell.exe", ["-NoProfile", "-File", scriptPath], {
      encoding: "utf8",
    });
    assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
    assert.match(result.stdout, /cached output changed or corrupted/);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
