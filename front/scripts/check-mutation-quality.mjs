import fs from "node:fs";
import path from "node:path";

const REPORT = process.env.MUTATION_REPORT || "reports/mutation/business-logic.json";
const BREAK_SCORE = 75;
const COVERED_TARGET = 90;

const reportPath = path.resolve(process.cwd(), REPORT);
if (!fs.existsSync(reportPath)) {
  throw new Error(`Mutation report was not found: ${reportPath}`);
}

const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
const counts = new Map();
for (const file of Object.values(report.files ?? {})) {
  for (const mutant of file.mutants ?? []) {
    counts.set(mutant.status, (counts.get(mutant.status) ?? 0) + 1);
  }
}

const count = (status) => counts.get(status) ?? 0;
const detected = count("Killed") + count("Timeout");
const survived = count("Survived");
const noCoverage = count("NoCoverage");
const valid = detected + survived + noCoverage;
const covered = detected + survived;
const score = valid ? (detected / valid) * 100 : 100;
const coveredScore = covered ? (detected / covered) * 100 : 100;
const format = (value) => value.toFixed(2);

console.log(
  `[MUTATION QUALITY] total=${format(score)}% covered=${format(coveredScore)}% ` +
    `(killed=${count("Killed")}, timeout=${count("Timeout")}, survived=${survived}, noCoverage=${noCoverage})`
);

if (score < BREAK_SCORE) {
  throw new Error(
    `Mutation score ${format(score)}% is below the release threshold ${BREAK_SCORE}%`
  );
}
if (coveredScore < COVERED_TARGET) {
  console.warn(
    `[MUTATION ADVISORY] Covered mutation score ${format(coveredScore)}% is below the ${COVERED_TARGET}% quality target.`
  );
} else {
  console.log(`[MUTATION QUALITY] Covered mutation target ${COVERED_TARGET}% reached.`);
}
