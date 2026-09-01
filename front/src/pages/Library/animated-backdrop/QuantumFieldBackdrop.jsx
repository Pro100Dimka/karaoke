import { useEffect, useMemo, useRef } from "react";

// The iframe is an about:srcdoc document. Electron's packaged file:// renderer
// does not reliably treat file assets referenced from that document as same-
// origin, so keep the four small theme backdrops self-contained for the frame.
// eslint-disable-next-line import/no-unresolved -- resolved by Vite's asset loaders
import darkBackdropUrl from "../../../assets/karaoke/dark.webp?inline";
// eslint-disable-next-line import/no-unresolved -- resolved by Vite's asset loaders
import greenBackdropUrl from "../../../assets/karaoke/green.webp?inline";
// eslint-disable-next-line import/no-unresolved -- resolved by Vite's asset loaders
import lightBackdropUrl from "../../../assets/karaoke/light.webp?inline";
// eslint-disable-next-line import/no-unresolved -- resolved by Vite's asset loaders
import violetBackdropUrl from "../../../assets/karaoke/violet.webp?inline";
// eslint-disable-next-line import/no-unresolved -- resolved by Vite's asset loaders
import qftRuntimeUrl from "./qftRuntime.js?worker&url";
// eslint-disable-next-line import/no-unresolved -- resolved by Vite's asset loaders
import qftSource from "./qftvisualizer.html?raw";
import "./quantum-field.css";

const THEME_BACKDROPS = Object.freeze({
  dark: darkBackdropUrl,
  green: greenBackdropUrl,
  light: lightBackdropUrl,
  violet: violetBackdropUrl
});

// Upstream: https://github.com/stridentsoundworks-spec/gftvisualizer
// Commit: 7958ba432beef5f72d2adf46b4a4f800d13255d0
function makeEmbeddedSource(source) {
  return source
    .replace(/<script type="importmap">[\s\S]*?<\/script>/, "")
    .replace(/<script>[\s\S]*?<\/script>/, "")
    .replace(
      /<script type="module">[\s\S]*?<\/script>\s*<\/body>/,
      `<script type="module" src="${qftRuntimeUrl}"></script></body>`
    );
}

export default function QuantumFieldBackdrop() {
  const source = useMemo(() => makeEmbeddedSource(qftSource), []);
  const frameRef = useRef(null);

  useEffect(() => {
    const frame = frameRef.current;

    const sendThemePalette = () => {
      const frameWindow = frame?.contentWindow;
      if (!frameWindow) return;

      const styles = getComputedStyle(document.documentElement);
      const color = (name, fallback) => styles.getPropertyValue(name).trim() || fallback;
      const theme = document.documentElement.dataset.theme || "dark";

      frameWindow.postMessage(
        {
          type: "QFT_THEME",
          theme,
          backgroundImage: `url("${THEME_BACKDROPS[theme] || THEME_BACKDROPS.dark}")`,
          backgroundColor: color("--color-bg-deep", "#000000"),
          palette: {
            primary: color("--color-primary", "#ff153f"),
            primaryHover: color("--color-primary-hover", "#ff5a69"),
            primaryStrong: color("--color-primary-strong", "#b90020"),
            secondary: color("--color-secondary", "#a20b1d"),
            accent: color("--color-accent", "#ff693f"),
            accentStrong: color("--color-accent-strong", "#eb0031"),
            highlight: color("--color-highlight", "#ffe0d6")
          }
        },
        "*"
      );
    };

    const handleSettingsMessage = (event) => {
      if (event.source !== frame?.contentWindow) return;
      if (event.data?.type === "QFT_READY") {
        sendThemePalette();
        return;
      }
      if (event.data?.type === "QFT_DISPOSED") {
        window.dispatchEvent(new CustomEvent("qft-disposed"));
        return;
      }
      if (event.data?.type !== "QFT_SETTINGS") return;

      // eslint-disable-next-line no-console -- user-requested settings export
      console.log(`[QFT_SETTINGS] ${event.data.serialized}`);
    };

    window.addEventListener("message", handleSettingsMessage);
    const themeObserver = new MutationObserver(sendThemePalette);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    frame?.addEventListener("load", sendThemePalette);
    sendThemePalette();

    let pointerFrame = 0;
    let pointerX = 0;
    let pointerY = 0;
    const sendPointer = () => {
      pointerFrame = 0;
      frame?.contentWindow?.postMessage({ type: "QFT_POINTER", x: pointerX, y: pointerY }, "*");
    };
    const queuePointer = (x, y) => {
      pointerX = x;
      pointerY = y;
      if (!pointerFrame) pointerFrame = requestAnimationFrame(sendPointer);
    };
    const handlePointerMove = (event) => {
      queuePointer(
        (event.clientX / Math.max(1, window.innerWidth)) * 2 - 1,
        (event.clientY / Math.max(1, window.innerHeight)) * 2 - 1
      );
    };
    const centerPointer = () => queuePointer(0, 0);
    window.addEventListener("pointermove", handlePointerMove, { passive: true });
    window.addEventListener("blur", centerPointer);
    document.documentElement.addEventListener("mouseleave", centerPointer);

    let radioFrame = 0;
    let lastRadioUpdate = 0;
    const sendRadioSpectrum = (timestamp) => {
      if (timestamp - lastRadioUpdate >= 32) {
        const styles = getComputedStyle(document.documentElement);
        const readLevel = (name) => {
          const value = Number.parseFloat(styles.getPropertyValue(name));
          return Number.isFinite(value) ? value : 0;
        };
        frame?.contentWindow?.postMessage(
          {
            type: "QFT_AUDIO",
            active: readLevel("--radio-analysis-active") >= 0.5,
            bass: readLevel("--radio-bass"),
            bands: Array.from({ length: 18 }, (_, index) => readLevel(`--radio-band-${index}`))
          },
          "*"
        );
        lastRadioUpdate = timestamp;
      }
      radioFrame = requestAnimationFrame(sendRadioSpectrum);
    };
    radioFrame = requestAnimationFrame(sendRadioSpectrum);

    return () => {
      frame?.contentWindow?.postMessage({ type: "QFT_DISPOSE" }, "*");
      window.removeEventListener("message", handleSettingsMessage);
      themeObserver.disconnect();
      frame?.removeEventListener("load", sendThemePalette);
      window.removeEventListener("pointermove", handlePointerMove);
      window.removeEventListener("blur", centerPointer);
      document.documentElement.removeEventListener("mouseleave", centerPointer);
      cancelAnimationFrame(pointerFrame);
      cancelAnimationFrame(radioFrame);
    };
  }, []);

  return (
    <div
      className="qft-original-backdrop"
      aria-hidden="true"
      style={{
        position: "fixed",
        pointerEvents: "none",
        // The iframe owns both the theme artwork and WebGL. Its artwork is an
        // inlined data URL so packaged file:// builds cannot replace it with
        // the iframe's white fallback surface.
        mixBlendMode: "normal",
        filter: "none"
      }}
    >
      <iframe
        ref={frameRef}
        className="qft-original-frame"
        title="Quantum Fields visualizer"
        tabIndex={-1}
        srcDoc={source}
        allow="autoplay; microphone; fullscreen"
      />
    </div>
  );
}
