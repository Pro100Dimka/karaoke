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
  // The quantum backdrop imports these modules only after the Library chunk
  // mounts. Pre-bundle them before Vite reports ready so Electron never sees
  // the dependency-discovery reload as a blank intermediate frame.
  optimizeDeps: {
    include: [
      "three",
      "three/addons/controls/OrbitControls.js",
      "three/addons/objects/Lensflare.js",
      "three/addons/postprocessing/AfterimagePass.js",
      "three/addons/postprocessing/EffectComposer.js",
      "three/addons/postprocessing/OutputPass.js",
      "three/addons/postprocessing/RenderPass.js",
      "three/addons/postprocessing/ShaderPass.js",
      "three/addons/postprocessing/UnrealBloomPass.js",
      "three/examples/jsm/libs/lil-gui.module.min.js"
    ]
  },
  build: {
    outDir: "../generated/build/frontend/dist",
    emptyOutDir: true
  }
});
