// Dependency/license manifest for the frontend npm environment. Uses
// `npm ls --all --json --long` (built into npm, no extra dependency) since
// `--long` already annotates every resolved package with its own license
// field from package.json.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

function collect(tree, seen = new Map()) {
  for (const [name, info] of Object.entries(tree.dependencies ?? {})) {
    // npm may report virtual/optional peer nodes for platforms where no
    // package was installed. They cannot be shipped and therefore do not
    // belong in the release-content SBOM.
    if (!info.path) continue;
    const key = `${name}@${info.version ?? "unknown"}`;
    if (!seen.has(key)) {
      let license = info.license;
      if (!license && info.path) {
        try {
          license = JSON.parse(readFileSync(resolve(info.path, "package.json"), "utf8")).license;
        } catch {}
      }
      seen.set(key, { name, version: info.version ?? "unknown", license: license ?? "UNKNOWN" });
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
    return execFileSync("npm", ["ls", "--all", "--omit=dev", "--json", "--long"], options);
  } catch (error) {
    // npm exits non-zero when the tree has extraneous/invalid entries even
    // though it still printed a usable tree to stdout.
    if (typeof error.stdout === "string" && error.stdout.trim()) return error.stdout;
    throw error;
  }
}

const tree = JSON.parse(npmLsTree());
const packages = [...collect(tree).values()].sort((a, b) => a.name.localeCompare(b.name));

const project = process.argv[2] || "frontend";
if (!/^[a-z][a-z0-9-]*$/.test(project)) throw new Error(`Invalid SBOM project name: ${project}`);
const outputPath = resolve(process.cwd(), `../generated/sbom/${project}.json`);
await mkdir(resolve(outputPath, ".."), { recursive: true });
await writeFile(outputPath, `${JSON.stringify({ packageCount: packages.length, packages }, null, 2)}\n`, "utf8");

const unknown = packages.filter((pkg) => !pkg.license || pkg.license === "UNKNOWN").map((pkg) => pkg.name);
console.log(`Wrote ${packages.length} packages to ${outputPath}`);
if (unknown.length > 0) console.log(`${unknown.length} package(s) have no declared license: ${unknown.join(", ")}`);
