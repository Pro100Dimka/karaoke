import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  // The packaged Electron window loads index.html with file://, so asset URLs
  // must stay relative instead of assuming a web server root.
  base: "./",
  server: {
    // Electron loads this exact IPv4 address in development. Explicit binding
    // avoids a Windows localhost resolving to IPv6-only (::1) Vite server.
    host: "127.0.0.1",
    port: 5173,
    strictPort: true
  },
  build: {
    outDir: "../build/frontend/dist",
    emptyOutDir: true
  }
});
