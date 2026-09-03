import { translateSaved as tr } from "../../../../i18n/runtime";

export default (message) => {
  const text = String(message || "").trim();
  const [type, ...reason] = text.split(":");
  const error = text.toLowerCase();

  const hint = /ctc|model unavailable/.test(error)
    ? "library.alignmentModelUnavailableCheckTheAiModelInstallationAnd"
    : /timestamp|interval/.test(error)
      ? "library.couldNotAlignWordIntervalsToVocalsCheckThe"
      : "library.retryProcessingIfTheErrorPersistsOpenTheExecution";

  return {
    type: (reason.length && type.trim()) || "ProcessingError",
    reason: reason.join(":").trim() || text || tr("library.backendDidNotProvideAReason"),
    hint: tr(hint)
  };
};
