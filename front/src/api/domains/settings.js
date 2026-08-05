import { request } from "../core";

export const settingsApi = {
  getAppSettings: () => request("/settings"),
  updateAppSettings: (patch) =>
    request("/settings", { method: "PATCH", body: JSON.stringify(patch) })
};
