import { encodePathSegment, request } from "../core";
import { normalizeModel } from "../normalizers";

export const modelsApi = {
  listWhisperModels: () =>
    request("/models/whisper").then((models) =>
      Array.isArray(models) ? models.map(normalizeModel) : []
    ),
  downloadModel: (name) =>
    request(`/models/whisper/${encodePathSegment(name)}/download`, { method: "POST" }),
  deleteModel: (name) =>
    request(`/models/whisper/${encodePathSegment(name)}`, { method: "DELETE" }),
  selectModel: (name) =>
    request(`/models/whisper/${encodePathSegment(name)}/select`, { method: "POST" })
};
