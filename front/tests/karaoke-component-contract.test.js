import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const karaokeRoot = path.join(root, "src/pages/Karaoke");

function walk(directory) {
  return fs.readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(directory, entry.name);
    if (entry.isDirectory()) return walk(fullPath);
    return fullPath.endsWith(".jsx") ? [fullPath] : [];
  });
}

function allSources() {
  return walk(karaokeRoot).map((file) => ({
    file: path.relative(root, file),
    source: fs.readFileSync(file, "utf8")
  }));
}

test("all native Karaoke buttons explicitly declare type", () => {
  const missing = [];
  for (const { file, source } of allSources()) {
    const tags = source.match(/<button\b[\s\S]*?>/g) || [];
    for (const tag of tags) {
      if (!/\btype=/.test(tag)) missing.push(`${file}: ${tag}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("icon-only Karaoke buttons have an accessible name", () => {
  const requiredLabels = [
    "Закрыть анализ",
    "Воспроизвести запись",
    "Выключить звук",
    "Включить звук"
  ];
  const source = [
    fs.readFileSync(
      path.join(karaokeRoot, "components/PerformanceAnalysisModal.jsx"),
      "utf8"
    ),
    fs.readFileSync(path.join(root, "src/components/AudioPlayer.jsx"), "utf8")
  ].join("\n");
  for (const label of requiredLabels) assert.match(source, new RegExp(label));
});

test("analysis request cache is keyed by recording id", () => {
  const source = fs.readFileSync(
    path.join(karaokeRoot, "components/PerformanceAnalysisModal.jsx"),
    "utf8"
  );
  assert.match(
    source,
    /analysisRequestRef\.current\.recordingId !== recordingId/
  );
  assert.match(
    source,
    /recordingId,\s*promise: api\.runAnalysis\(recordingId\)/
  );
  assert.match(source, /setResult\(null\)/);
  assert.match(source, /setError\(null\)/);
});

test("Karaoke range inputs expose accessible labels", () => {
  const missing = [];
  for (const { file, source } of allSources()) {
    const tags = source.match(/<input\b[\s\S]*?>/g) || [];
    for (const tag of tags) {
      if (!/type=["']range["']/.test(tag)) continue;
      const hasAria = /aria-label=|aria-labelledby=/.test(tag);
      const hasId = /\bid=/.test(tag);
      if (!hasAria && !hasId) missing.push(`${file}: ${tag}`);
    }
  }
  assert.deepEqual(missing, []);
});

test("dialog-like Karaoke overlays keep modal semantics", () => {
  const source = fs.readFileSync(
    path.join(karaokeRoot, "components/PerformanceAnalysisModal.jsx"),
    "utf8"
  );
  assert.match(source, /<Modal/);
  assert.match(source, /ariaLabel="Анализ выступления"/);
  assert.match(source, /portal/);
});

test("analysis UI uses normalized data helpers", () => {
  const modal = fs.readFileSync(
    path.join(karaokeRoot, "components/PerformanceAnalysisModal.jsx"),
    "utf8"
  );
  assert.match(modal, /normalizeAnalysisResult/);
  assert.match(modal, /getAnalysisFeedback/);
  assert.match(modal, /<AudioPlayer/);
});
