import { translateSaved } from "../../../i18n/runtime";

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
    label:
      typeof source.label === "string" && source.label.trim()
        ? source.label.trim()
        : null,
    start,
    end: end != null && (start == null || end >= start) ? end : null,
    accuracy_percent: clampPercent(source.accuracy_percent),
    mean_deviation_semitones: finiteOrNull(source.mean_deviation_semitones),
    index
  };
}
export function normalizeAnalysisResult(result) {
  const source = result && typeof result === "object" ? result : {};
  return {
    ...source,
    pitch_accuracy_percent: clampPercent(source.pitch_accuracy_percent),
    mean_deviation_semitones: finiteOrNull(source.mean_deviation_semitones),
    sections: (Array.isArray(source.sections) ? source.sections : [])
      .filter((section) => section && typeof section === "object")
      .map(normalizeAnalysisSection)
  };
}
export function getAnalysisFeedback(result) {
  const normalized = normalizeAnalysisResult(result);
  const accuracy = normalized.pitch_accuracy_percent;
  const scoredSections = normalized.sections.filter(
    (section) => section.accuracy_percent != null
  );
  const bestSection = scoredSections.reduce(
    (best, section) =>
      !best || section.accuracy_percent > best.accuracy_percent
        ? section
        : best,
    null
  );
  const needsPractice = scoredSections.reduce(
    (worst, section) =>
      !worst || section.accuracy_percent < worst.accuracy_percent
        ? section
        : worst,
    null
  );
  const grade =
    accuracy == null
      ? translateSaved("Нет данных")
      : accuracy >= 85
        ? translateSaved("Отличное исполнение")
        : accuracy >= 70
          ? translateSaved("Хороший результат")
          : accuracy >= 50
            ? translateSaved("Есть потенциал")
            : translateSaved("Нужно потренироваться");
  const advice =
    accuracy == null
      ? translateSaved(
          "Не удалось определить достаточно пропетых нот. Попробуйте петь ближе к микрофону."
        )
      : normalized.mean_deviation_semitones != null &&
          normalized.mean_deviation_semitones > 1
        ? translateSaved(
            "Сфокусируйтесь на точном начале каждой фразы и удержании высоты ноты."
          )
        : accuracy >= 70
          ? translateSaved(
              "Хорошая точность. Попробуйте сделать фразы ровнее по громкости и дыханию."
            )
          : translateSaved(
              "Повторите сложные фразы медленнее, ориентируясь на ноты на экране."
            );
  return {
    ...normalized,
    accuracy,
    scoredSections,
    bestSection,
    needsPractice,
    grade,
    advice
  };
}
