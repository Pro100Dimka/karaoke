import { rm } from "node:fs/promises";
import { resolve } from "node:path";

const targets = ["dist", "reports", ".runtime"];

await Promise.all(
  targets.map((target) =>
    rm(resolve(process.cwd(), target), { recursive: true, force: true })
  )
);

console.log(`Removed ${targets.length} generated directories.`);
