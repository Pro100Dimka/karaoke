import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./index.css";
import { getSavedTheme } from "./utils/theme";

// Paint the last selected theme before React mounts. The provider will later
// reconcile it with the persisted backend settings without a dark-theme flash.
document.documentElement.dataset.theme = getSavedTheme();

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
