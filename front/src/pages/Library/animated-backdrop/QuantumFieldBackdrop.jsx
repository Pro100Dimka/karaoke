import { useEffect, useMemo, useRef } from "react";

// eslint-disable-next-line import/no-unresolved -- resolved by Vite's asset loaders
import qftRuntimeUrl from "./qftRuntime.js?worker&url";
// eslint-disable-next-line import/no-unresolved -- resolved by Vite's asset loaders
import qftSource from "./qftvisualizer.html?raw";
import "./quantum-field.css";

// Upstream: https://github.com/stridentsoundworks-spec/gftvisualizer
// Commit: 7958ba432beef5f72d2adf46b4a4f800d13255d0
function makeEmbeddedSource(source) {
  const cacheBustedRuntimeUrl = `${qftRuntimeUrl}${qftRuntimeUrl.includes("?") ? "&" : "?"}v=29`;

  return source
    .replace(/<script type="importmap">[\s\S]*?<\/script>/, "")
    .replace(/<script>[\s\S]*?<\/script>/, "")
    .replace(
      /<script type="module">[\s\S]*?<\/script>\s*<\/body>/,
      `<script type="module" src="${cacheBustedRuntimeUrl}"></script></body>`
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

      frameWindow.postMessage(
        {
          type: "QFT_THEME",
          theme: document.documentElement.dataset.theme || "dark",
          palette: {
            primary: color("--color-primary", "#ff153f"),
            primaryHover: color("--color-primary-hover", "#ff5a69"),
            primaryStrong: color("--color-primary-strong", "#b90020"),
            secondary: color("--color-secondary", "#a20b1d"),
            accent: color("--color-accent", "#ff693f"),
            accentStrong: color("--color-accent-strong", "#eb0031"),
            highlight: color("--color-highlight", "#ffe0d6"),
          },
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
      if (event.data?.type !== "QFT_SETTINGS") return;

      // eslint-disable-next-line no-console -- user-requested settings export
      console.log(`[QFT_SETTINGS] ${event.data.serialized}`);
    };

    window.addEventListener("message", handleSettingsMessage);
    const themeObserver = new MutationObserver(sendThemePalette);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    frame?.addEventListener("load", sendThemePalette);
    sendThemePalette();

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
            bands: Array.from({ length: 18 }, (_, index) =>
              readLevel(`--radio-band-${index}`)
            ),
          },
          "*"
        );
        lastRadioUpdate = timestamp;
      }
      radioFrame = requestAnimationFrame(sendRadioSpectrum);
    };
    radioFrame = requestAnimationFrame(sendRadioSpectrum);

    return () => {
      window.removeEventListener("message", handleSettingsMessage);
      themeObserver.disconnect();
      frame?.removeEventListener("load", sendThemePalette);
      cancelAnimationFrame(radioFrame);
    };
  }, []);

  return (
    <div
      className="qft-original-backdrop"
      aria-hidden="true"
      style={{ position: "fixed", pointerEvents: "none" }}
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
