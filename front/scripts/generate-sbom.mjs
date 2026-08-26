// Dependency/license manifest for the frontend npm environment. Uses
// `npm ls --all --json --long` (built into npm, no extra dependency) since
// `--long` already annotates every resolved package with its own license
// field from package.json.
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function collect(tree, seen = new Map()) {
  for (const [name, info] of Object.entries(tree.dependencies ?? {})) {
    const key = `${name}@${info.version ?? "unknown"}`;
    if (!seen.has(key)) {
      seen.set(key, { name, version: info.version ?? "unknown", license: info.license ?? "UNKNOWN" });
    }
    collect(info, seen);
  }
  return seen;
}

function npmLsTree() {
  const options = {
    cwd: process.cwd(),
    maxBuffer: 64 * 1024 * 1024,
    shell: true,
    encoding: "utf8"
  };
  try {
    return execFileSync("npm", ["ls", "--all", "--json", "--long"], options);
  } catch (error) {
    // npm exits non-zero when the tree has extraneous/invalid entries even
    // though it still printed a usable tree to stdout.
    if (typeof error.stdout === "string" && error.stdout.trim()) return error.stdout;
    throw error;
  }
}

const tree = JSON.parse(npmLsTree());
const packages = [...collect(tree).values()].sort((a, b) => a.name.localeCompare(b.name));

const outputPath = resolve(process.cwd(), "../generated/sbom/frontend.json");
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ packageCount: packages.length, packages }, null, 2)}\n`, "utf8");

const unknown = packages.filter((pkg) => !pkg.license || pkg.license === "UNKNOWN").map((pkg) => pkg.name);
console.log(`Wrote ${packages.length} packages to ${outputPath}`);
if (unknown.length > 0) console.log(`${unknown.length} package(s) have no declared license: ${unknown.join(", ")}`);
