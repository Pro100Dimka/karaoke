/* eslint-disable import/no-unresolved */
import { useEffect, useRef, useState } from "react";
import dark from "../../../assets/karaoke/dark.webp?inline";
import green from "../../../assets/karaoke/green.webp?inline";
import light from "../../../assets/karaoke/light.webp?inline";
import violet from "../../../assets/karaoke/violet.webp?inline";
import useHardwareSuspended from "../../../hooks/useHardwareSuspended";
import qftRuntime from "./qftRuntime.js?worker&url";
import qftSource from "./qftvisualizer.html?raw";
import "./quantum-field.css";

const backdrops = { dark, green, light, violet };

const palette = {
  primary: ["--color-primary", "#ff153f"],
  primaryHover: ["--color-primary-hover", "#ff5a69"],
  primaryStrong: ["--color-primary-strong", "#b90020"],
  secondary: ["--color-secondary", "#a20b1d"],
  accent: ["--color-accent", "#ff693f"],
  accentStrong: ["--color-accent-strong", "#eb0031"],
  highlight: ["--color-highlight", "#ffe0d6"]
};

const source = qftSource
  .replace(/<script type="importmap">[\s\S]*?<\/script>/, "")
  .replace(/<script>[\s\S]*?<\/script>/, "")
  .replace(
    /<script type="module">[\s\S]*?<\/script>\s*<\/body>/,
    `<script type="module" src="${qftRuntime}"></script></body>`
  );

const listen = (target, type, handler, options) => {
  target?.addEventListener(type, handler, options);
  return () => target?.removeEventListener(type, handler, options);
};

function useQft(suspended) {
  const ref = useRef(null);
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (suspended) {
      setReady(false);
      return;
    }
    const frame = ref.current;
    const root = document.documentElement;
    const post = (type, data) => frame?.contentWindow?.postMessage({ type, ...data }, "*");
    const sendTheme = () => {
      const styles = getComputedStyle(root);
      const read = ([name, fallback]) => styles.getPropertyValue(name).trim() || fallback;
      const theme = root.dataset.theme || "dark";
      post("QFT_THEME", {
        theme,
        backgroundImage: `url("${backdrops[theme] || dark}")`,
        backgroundColor: styles.getPropertyValue("--color-bg-deep").trim() || "#000",
        palette: Object.fromEntries(
          Object.entries(palette).map(([key, value]) => [key, read(value)])
        )
      });
    };

    const handlers = {
      QFT_READY: () => {
        sendTheme();
        setReady(true);
      },
      QFT_DISPOSED: () => window.dispatchEvent(new CustomEvent("qft-disposed")),
      QFT_SETTINGS: ({ serialized }) => {
        // eslint-disable-next-line no-console
        console.log(`[QFT_SETTINGS] ${serialized}`);
      }
    };

    const onMessage = ({ source, data = {} }) =>
      source === frame?.contentWindow && handlers[data.type]?.(data);
    const observer = new MutationObserver(sendTheme);
    observer.observe(root, { attributes: true, attributeFilter: ["data-theme"] });
    let pointerFrame;
    let pointer = [0, 0];
    const queuePointer = (...next) => {
      pointer = next;
      pointerFrame ||= requestAnimationFrame(() => {
        pointerFrame = 0;
        post("QFT_POINTER", { x: pointer[0], y: pointer[1] });
      });
    };
    const onPointer = ({ clientX, clientY }) =>
      queuePointer(
        (clientX / Math.max(1, innerWidth)) * 2 - 1,
        (clientY / Math.max(1, innerHeight)) * 2 - 1
      );
    const center = () => queuePointer(0, 0);
    let audioFrame;
    let lastAudio = 0;
    const sendAudio = (time) => {
      if (time - lastAudio >= 32) {
        const styles = getComputedStyle(root);
        const level = (name) => parseFloat(styles.getPropertyValue(name)) || 0;
        post("QFT_AUDIO", {
          active: level("--radio-analysis-active") >= 0.5,
          bass: level("--radio-bass"),
          bands: Array.from({ length: 18 }, (_, i) => level(`--radio-band-${i}`))
        });
        lastAudio = time;
      }
      audioFrame = requestAnimationFrame(sendAudio);
    };
    const cleanup = [
      [window, "message", onMessage],
      [frame, "load", sendTheme],
      [window, "pointermove", onPointer, { passive: true }],
      [window, "blur", center],
      [root, "mouseleave", center]
    ].map((args) => listen(...args));
    sendTheme();
    audioFrame = requestAnimationFrame(sendAudio);
    return () => {
      post("QFT_DISPOSE");
      cleanup.forEach((remove) => remove());
      observer.disconnect();
      cancelAnimationFrame(pointerFrame);
      cancelAnimationFrame(audioFrame);
    };
  }, [suspended]);
  return [ref, ready];
}

export default function QuantumFieldBackdrop() {
  const suspended = useHardwareSuspended();
  const [ref, ready] = useQft(suspended);
  if (suspended) return null;
  return (
    <div className="qft-original-backdrop" aria-hidden style={{ opacity: +ready }}>
      <iframe
        ref={ref}
        className="qft-original-frame"
        title="Quantum Fields visualizer"
        tabIndex={-1}
        srcDoc={source}
        allow="autoplay; microphone; fullscreen"
      />
    </div>
  );
}
