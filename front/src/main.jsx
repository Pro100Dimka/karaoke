import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { queryClient } from "./query-client";
import { installGlobalErrorReporting } from "./utils/error-reporter";
import { applyPerformanceProfile } from "./utils/performance-profile";
import * as platform from "./utils/platform";
import { getSavedTheme, saveTheme, THEME_BACKGROUNDS } from "./utils/theme";

const electronTheme = platform.initialTheme();
const initialTheme = electronTheme ? saveTheme(electronTheme) : getSavedTheme();
document.documentElement.dataset.theme = initialTheme;
const initialBackground = THEME_BACKGROUNDS[initialTheme] || THEME_BACKGROUNDS.dark;
document.documentElement.style.backgroundColor = initialBackground;
document.body.style.backgroundColor = initialBackground;
applyPerformanceProfile(window);
installGlobalErrorReporting();
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);

const waitForBackdrop = () =>
  new Promise((resolve) => {
    const value = getComputedStyle(document.documentElement).getPropertyValue("--bg-image");
    const source = value.match(/url\((['"]?)(.*?)\1\)/)?.[2];
    if (!source) {
      resolve();
      return;
    }

    const image = new Image();
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      resolve();
    };
    const timeout = setTimeout(finish, 3500);
    image.onload = finish;
    image.onerror = finish;
    image.src = source;
    image.decode?.().then(finish, () => {});
  });

// Electron keeps the native window hidden until the theme backdrop is decoded.
// Two frames also let the browser commit the background before the first show.
waitForBackdrop()
  .then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))))
  .then(() => platform.recordStartupMilestone("visual-ready"));
