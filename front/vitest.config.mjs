import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  test: {
    environment: "node",
    include: ["tests/**/*.test.{js,jsx,mjs}"],
    exclude: ["tests/e2e/**"],
    coverage: {
      provider: "v8",
      all: true,
      include: ["src/**/*.{js,jsx}"],
      exclude: [
        "src/assets/**",
        "src/theme/**",
        "src/main.jsx",
        "src/**/*.test.{js,jsx}"
      ],
      reporter: ["text", "json-summary", "html"],
      reportsDirectory: "coverage",
      thresholds: { statements: 80, branches: 75, functions: 80, lines: 80 }
    }
  }
});
