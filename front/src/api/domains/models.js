import { request } from "../core";

export const modelsApi = {
  listWhisperModels: () => request("/models/whisper"),
  downloadModel: (name) =>
    request(`/models/whisper/${name}/download`, { method: "POST" }),
  deleteModel: (name) =>
    request(`/models/whisper/${name}`, { method: "DELETE" }),
  selectModel: (name) =>
    request(`/models/whisper/${name}/select`, { method: "POST" })
};
