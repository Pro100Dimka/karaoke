import { getSavedTheme, saveTheme } from "../../utils/theme";
import { request } from "../core";

const preferenceWrites = new Map();
function updateUiPreferences(namespace, patch) {
  const write = () =>
    request(`/preferences/${encodeURIComponent(namespace)}`, {
      method: "PATCH",
      body: JSON.stringify(patch)
    });
  const previous = preferenceWrites.get(namespace);
  const pending = previous ? previous.catch(() => {}).then(write) : write();
  const next = pending.finally(() => {
    if (preferenceWrites.get(namespace) === next) preferenceWrites.delete(namespace);
  });
  preferenceWrites.set(namespace, next);
  return next;
}

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
      ...(await request("/settings", { method: "PATCH", body: JSON.stringify(backendPatch) })),
      ...localPatch
    };
  },
  getRemoteDiagnosticsPolicy: () => request("/settings/remote-diagnostics"),
  deleteRemoteDiagnostics: () => request("/settings/remote-diagnostics", { method: "DELETE" }),
  getUiPreferences: () => request("/preferences"),
  updateUiPreferences
};
