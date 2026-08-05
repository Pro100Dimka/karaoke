import assert from "node:assert/strict";
import test from "node:test";
import {
  getAnalysisFeedback,
  getAnalysisSectionLabel,
  normalizeAnalysisResult,
  normalizeAnalysisSection
} from "../src/pages/Karaoke/utils/analysis.js";

test("normalizeAnalysisResult constrains percentages and invalid primitives", () => {
  assert.deepEqual(normalizeAnalysisResult(null), {
    pitch_accuracy_percent: null,
    mean_deviation_semitones: null,
    sections: []
  });
  const result = normalizeAnalysisResult({
    pitch_accuracy_percent: 150,
    mean_deviation_semitones: "0.75",
    sections: [null, { accuracy_percent: -20 }]
  });
  assert.equal(result.pitch_accuracy_percent, 100);
  assert.equal(result.mean_deviation_semitones, 0.75);
  assert.equal(result.sections.length, 1);
  assert.equal(result.sections[0].accuracy_percent, 0);
});

test("normalizeAnalysisSection rejects reversed or non-finite ranges", () => {
  assert.deepEqual(
    normalizeAnalysisSection(
      { label: "  Куплет  ", start: 5, end: 2, accuracy_percent: "85" },
      3
    ),
    {
      label: "Куплет",
      start: 5,
      end: null,
      accuracy_percent: 85,
      mean_deviation_semitones: null,
      index: 3
    }
  );
});

test("analysis feedback follows grade boundaries", () => {
  const cases = [
    [null, "Нет данных"],
    [0, "Нужно потренироваться"],
    [49.99, "Нужно потренироваться"],
    [50, "Есть потенциал"],
    [69.99, "Есть потенциал"],
    [70, "Хороший результат"],
    [84.99, "Хороший результат"],
    [85, "Отличное исполнение"],
    [100, "Отличное исполнение"]
  ];
  for (const [accuracy, expected] of cases) {
    assert.equal(
      getAnalysisFeedback({ pitch_accuracy_percent: accuracy }).grade,
      expected
    );
  }
});

test("analysis feedback selects best and weakest scored sections", () => {
  const feedback = getAnalysisFeedback({
    pitch_accuracy_percent: 75,
    sections: [
      { label: "A", accuracy_percent: 55 },
      { label: "B", accuracy_percent: null },
      { label: "C", accuracy_percent: 92 }
    ]
  });
  assert.equal(feedback.scoredSections.length, 2);
  assert.equal(feedback.bestSection.label, "C");
  assert.equal(feedback.needsPractice.label, "A");
});

test("analysis advice prioritizes large pitch deviation", () => {
  assert.match(
    getAnalysisFeedback({
      pitch_accuracy_percent: 90,
      mean_deviation_semitones: 1.01
    }).advice,
    /точном начале/
  );
  assert.match(
    getAnalysisFeedback({
      pitch_accuracy_percent: 90,
      mean_deviation_semitones: 0.5
    }).advice,
    /Хорошая точность/
  );
  assert.match(
    getAnalysisFeedback({ pitch_accuracy_percent: 30 }).advice,
    /Повторите сложные фразы/
  );
});

test("section labels always have a readable fallback", () => {
  assert.equal(getAnalysisSectionLabel({ label: "Припев" }, 0), "Припев");
  assert.equal(
    getAnalysisSectionLabel({ start: 1.25, end: 3.75 }, 0),
    "1.3–3.8 с"
  );
  assert.equal(getAnalysisSectionLabel({}, 4), "Фрагмент 5");
  assert.equal(getAnalysisSectionLabel(null, 0), "Фрагмент 1");
});
