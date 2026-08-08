import { getSavedTheme, saveTheme } from "../../utils/theme";
import { request } from "../core";

export const settingsApi = {
  getAppSettings: async () => ({
    ...(await request("/settings")),
    // Frontend supports extra visual themes that older backend versions
    // validate as only "dark" | "light". Keep the selected visual theme
    // local so green/violet survive restarts without causing a 422 response.
    theme: getSavedTheme()
  }),

  updateAppSettings: async (patch) => {
    const { theme, ...backendPatch } = patch ?? {};
    const localPatch = {};

    if (theme !== undefined) {
      localPatch.theme = saveTheme(theme);
    }

    if (!Object.keys(backendPatch).length) return localPatch;

    return {
      ...(await request("/settings", {
        method: "PATCH",
        body: JSON.stringify(backendPatch)
      })),
      ...localPatch
    };
  }
};
