import { request } from "../core";

export const systemApi = {
  getCacheSize: () => request("/cache/size"),
  getFreeSpace: () => request("/cache/free-space"),
  clearCache: () => request("/cache/clear", { method: "POST" }),
  deleteTemp: () => request("/cache/temp", { method: "DELETE" }),
  optimizeSong: (songId) =>
    request(`/cache/optimize/${songId}`, { method: "POST" }),
  getHealth: () => request("/diagnostics/health"),
  getPipelineHealth: () => request("/diagnostics/pipeline"),
  getVersions: () => request("/diagnostics/versions"),
  getErrors: () => request("/diagnostics/errors"),
  getHistory: () => request("/history"),
  getAbout: () => request("/about")
};
