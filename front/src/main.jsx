import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { installGlobalErrorReporting } from "./utils/error-reporter";
import { applyPerformanceProfile } from "./utils/performance-profile";
import { getSavedTheme, saveTheme } from "./utils/theme";

// Paint the last selected theme before React mounts. The provider will later
// reconcile it with the persisted backend settings without a dark-theme flash.
document.documentElement.dataset.theme = window.electronAPI?.initialTheme
  ? saveTheme(window.electronAPI.initialTheme)
  : getSavedTheme();
applyPerformanceProfile(window);
// Installed before React mounts so even an early boot crash is captured.
installGlobalErrorReporting();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
