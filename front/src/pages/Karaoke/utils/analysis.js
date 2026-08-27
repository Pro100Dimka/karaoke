import { translateSaved } from "../../../i18n/runtime";

// Stryker disable next-line ArrayDeclaration: Array() and Array([]) are the same empty array.
const EMPTY_SECTIONS = Object.freeze(Array()); // eslint-disable-line no-array-constructor

const ANALYSIS_GRADES = [
  [85, () => translateSaved("Отличное исполнение")],
  [70, () => translateSaved("Хороший результат")],
  [50, () => translateSaved("Есть потенциал")],
  [-Infinity, () => translateSaved("Нужно потренироваться")]
];

function getAnalysisGrade(accuracy) {
  if (accuracy == null) return translateSaved("Нет данных");
  const [, getLabel] = ANALYSIS_GRADES.find(([minimum]) => accuracy >= minimum);
  return getLabel();
}

function getAnalysisAdvice(accuracy, meanDeviation, practiceMetric) {
  if (accuracy == null) {
    return translateSaved(
      "Не удалось определить достаточно пропетых нот. Попробуйте петь ближе к микрофону."
    );
  }
  if (meanDeviation > 1) {
    return translateSaved("Сфокусируйтесь на точном начале каждой фразы и удержании высоты ноты.");
  }
  const advice = {
    pitch: () =>
      translateSaved("Потренируйте точное попадание в высоту нот, начиная с медленного темпа."),
    rhythm: () =>
      translateSaved(
        "Потренируйте моменты вступления: слушайте сильную долю и начинайте фразу вместе с минусовкой."
      ),
    hold: () =>
      translateSaved(
        "Удерживайте ноту ровнее до её окончания и распределяйте дыхание на всю фразу."
      ),
    coverage: () =>
      translateSaved("Пойте все отмеченные фразы ближе к микрофону, не пропуская окончания слов.")
  };
  if (practiceMetric?.key && advice[practiceMetric.key]) return advice[practiceMetric.key]();
  return accuracy >= 70
    ? translateSaved("Хорошая точность. Попробуйте сделать фразы ровнее по громкости и дыханию.")
    : translateSaved("Повторите сложные фразы медленнее, ориентируясь на ноты на экране.");
}

function finiteOrNull(value) {
  if (value == null || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
function clampPercent(value) {
  const number = finiteOrNull(value);
  return number == null ? null : Math.max(0, Math.min(100, number));
}
export function normalizeAnalysisSection(section, index = 0) {
  const source = section && typeof section === "object" ? section : {};
  const start = finiteOrNull(source.start);
  const end = finiteOrNull(source.end);
  return {
    ...source,
    label: typeof source.label === "string" && source.label.trim() ? source.label.trim() : null,
    start,
    end: start == null || end >= start ? end : null,
    accuracy_percent: clampPercent(source.accuracy_percent),
    mean_deviation_semitones: finiteOrNull(source.mean_deviation_semitones),
    index
  };
}
export function normalizeAnalysisResult(result) {
  const source = result && typeof result === "object" ? result : {};
  const sections = Array.isArray(source.sections) ? source.sections : null;
  return {
    ...source,
    pitch_accuracy_percent: clampPercent(source.pitch_accuracy_percent),
    rhythm_accuracy_percent: clampPercent(source.rhythm_accuracy_percent),
    note_hold_percent: clampPercent(source.note_hold_percent),
    note_coverage_percent: clampPercent(source.note_coverage_percent),
    overall_score_percent: clampPercent(source.overall_score_percent),
    mean_deviation_semitones: finiteOrNull(source.mean_deviation_semitones),
    sections: sections
      ? sections
          .filter((section) => section && typeof section === "object")
          .map(normalizeAnalysisSection)
      : EMPTY_SECTIONS
  };
}
export function getAnalysisFeedback(result) {
  const normalized = normalizeAnalysisResult(result);
  const accuracy = normalized.overall_score_percent ?? normalized.pitch_accuracy_percent;
  const metrics = [
    { key: "pitch", value: normalized.pitch_accuracy_percent },
    { key: "rhythm", value: normalized.rhythm_accuracy_percent },
    { key: "hold", value: normalized.note_hold_percent },
    { key: "coverage", value: normalized.note_coverage_percent }
  ].filter(({ value }) => value != null);
  const practiceMetric =
    metrics.length > 1
      ? metrics.reduce(
          (worst, metric) => (!worst || metric.value < worst.value ? metric : worst),
          null
        )
      : null;
  const scoredSections = normalized.sections.filter((section) => section.accuracy_percent != null);
  const bestSection = scoredSections.reduce(
    (best, section) => (!best || section.accuracy_percent > best.accuracy_percent ? section : best),
    null
  );
  const needsPractice = scoredSections.reduce(
    (worst, section) =>
      !worst || section.accuracy_percent < worst.accuracy_percent ? section : worst,
    null
  );
  const grade = getAnalysisGrade(accuracy);
  const advice = getAnalysisAdvice(accuracy, normalized.mean_deviation_semitones, practiceMetric);
  return {
    ...normalized,
    accuracy,
    metrics,
    practiceMetric,
    scoredSections,
    bestSection,
    needsPractice,
    grade,
    advice
  };
}
