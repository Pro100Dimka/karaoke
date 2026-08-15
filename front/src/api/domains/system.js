import { encodePathSegment, request } from "../core";

export const systemApi = {
  getCacheSize: () => request("/cache/size"),
  getFreeSpace: () => request("/cache/free-space"),
  clearCache: () => request("/cache/clear", { method: "POST" }),
  deleteTemp: () => request("/cache/temp", { method: "DELETE" }),
  optimizeSong: (songId) =>
    request(`/cache/optimize/${encodePathSegment(songId)}`, { method: "POST" }),
  getHealth: () => request("/diagnostics/health"),
  getPipelineHealth: () => request("/diagnostics/pipeline"),
  getAiModelsStatus: () => request("/diagnostics/ai-models"),
  downloadAiModels: () =>
    request("/diagnostics/ai-models/download", { method: "POST" }),
  getVersions: () => request("/diagnostics/versions"),
  getErrors: () => request("/diagnostics/errors"),
  getHistory: () => request("/history"),
  getAbout: () => request("/about")
};
