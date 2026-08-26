import { QueryClientProvider } from "@tanstack/react-query";
import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { queryClient } from "./query-client";
import { installGlobalErrorReporting } from "./utils/error-reporter";
import { applyPerformanceProfile } from "./utils/performance-profile";
import * as platform from "./utils/platform";
import { getSavedTheme, saveTheme } from "./utils/theme";

const electronTheme = platform.initialTheme();
document.documentElement.dataset.theme = electronTheme ? saveTheme(electronTheme) : getSavedTheme();
applyPerformanceProfile(window);
installGlobalErrorReporting();
ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </React.StrictMode>
);
