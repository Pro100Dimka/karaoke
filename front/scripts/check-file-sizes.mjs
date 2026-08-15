import fs from "node:fs";
import path from "node:path";

const limits = { ".js": 700, ".jsx": 700, ".css": 1800 };
const root = path.join(process.cwd(), "src");
function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const file = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      if (file === path.join(root, "theme")) return [];
      return walk(file);
    }
    return [file];
  });
}
const warnings = [];
for (const file of walk(root)) {
  const extension = path.extname(file);
  const limit = limits[extension];
  if (!limit) continue;
  const lines = fs.readFileSync(file, "utf8").split(/\r?\n/).length;
  if (lines > limit)
    warnings.push({ file: path.relative(process.cwd(), file), lines, limit });
}
if (!warnings.length) console.log("All source files are within advisory size limits."); else {
  console.log("Advisory large-file report:");
  for (const warning of warnings) {
    console.log(
      `- ${warning.file}: ${warning.lines} lines (recommended <= ${warning.limit})`
    );
  }
}
