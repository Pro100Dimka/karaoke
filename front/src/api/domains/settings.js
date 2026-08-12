import { getSavedTheme, saveTheme } from "../../utils/theme";
import { request } from "../core";

export const settingsApi = {
  getAppSettings: async () => {
    const settings = await request("/settings");
    return { ...settings, theme: settings.theme || getSavedTheme() };
  },

  updateAppSettings: async (patch) => {
    const { theme, ...backendPatch } = patch ?? {};
    const localPatch = {};

    if (theme !== undefined) {
      localPatch.theme = saveTheme(theme);
      backendPatch.theme = localPatch.theme;
    }

    return {
      ...(await request("/settings", {
        method: "PATCH",
        body: JSON.stringify(backendPatch)
      })),
      ...localPatch
    };
  },
  getUiPreferences: () => request("/preferences"),
  updateUiPreferences: (namespace, patch) =>
    request(`/preferences/${encodeURIComponent(namespace)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    })
};
