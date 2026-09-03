/* eslint-disable import/no-unresolved */

import { useEffect, useRef, useState } from "react";
import dark from "../../../assets/karaoke/dark.webp?inline";
import green from "../../../assets/karaoke/green.webp?inline";
import light from "../../../assets/karaoke/light.webp?inline";
import violet from "../../../assets/karaoke/violet.webp?inline";
import useHardwareSuspended from "../../../hooks/useHardwareSuspended";
import qftRuntime from "./qftRuntime.js?worker&url";
import "./quantum-field.css";

const backdrops = { dark, green, light, violet };

const colors = {
  primary: "#ff153f",
  primaryHover: "#ff5a69",
  secondary: "#a20b1d",
  accent: "#ff693f",
  highlight: "#ffe0d6"
};

const source = `
<style>
  html,body{margin:0;width:100%;height:100%;overflow:hidden;background:transparent}
</style>
<script type="module" src="${qftRuntime}"></script>
`;

const cssName = (key) => `--color-${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)}`;

export default function QuantumFieldBackdrop() {
  const hardwareSuspended = useHardwareSuspended();
  const [visible, setVisible] = useState(() => !document.hidden);
  const frame = useRef(null);
  const suspended = hardwareSuspended && !visible;

  useEffect(() => {
    const update = () => setVisible(!document.hidden);

    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  useEffect(() => {
    const iframe = frame.current;
    if (suspended || !iframe) return;

    const root = document.documentElement;
    const abort = new AbortController();
    const { signal } = abort;
    const post = (type, data = {}) => iframe.contentWindow?.postMessage({ type, ...data }, "*");

    const sendTheme = () => {
      const css = getComputedStyle(root);
      const read = (name, fallback = "") => css.getPropertyValue(name).trim() || fallback;
      const theme = root.dataset.theme || "dark";

      post("QFT_THEME", {
        theme,
        backgroundImage: `url("${backdrops[theme] || dark}")`,
        backgroundColor: read("--color-bg-deep", "#000"),
        palette: Object.fromEntries(
          Object.entries(colors).map(([key, fallback]) => [key, read(cssName(key), fallback)])
        )
      });
    };

    window.addEventListener(
      "message",
      ({ source, data = {} }) => {
        if (source !== iframe.contentWindow) return;
        if (data.type === "QFT_READY") sendTheme();
        if (data.type === "QFT_DISPOSED") {
          window.dispatchEvent(new CustomEvent("qft-disposed"));
        }
      },
      { signal }
    );

    const observer = new MutationObserver(sendTheme);
    observer.observe(root, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });

    let pointerFrame = 0;
    const pointer = { x: 0, y: 0 };

    const sendPointer = () => {
      pointerFrame = 0;
      post("QFT_POINTER", pointer);
    };

    const movePointer = (x, y) => {
      pointer.x = x;
      pointer.y = y;
      pointerFrame ||= requestAnimationFrame(sendPointer);
    };

    window.addEventListener(
      "pointermove",
      ({ clientX, clientY }) =>
        movePointer(
          (clientX / Math.max(1, innerWidth)) * 2 - 1,
          (clientY / Math.max(1, innerHeight)) * 2 - 1
        ),
      { passive: true, signal }
    );

    window.addEventListener("blur", () => movePointer(0, 0), { signal });

    const bands = Array(18).fill(0);

    const sendAudio = () => {
      const css = getComputedStyle(root);
      const level = (name) => parseFloat(css.getPropertyValue(name)) || 0;

      for (let i = 0; i < bands.length; i++) {
        bands[i] = level(`--radio-band-${i}`);
      }

      post("QFT_AUDIO", {
        bands,
        bass: level("--radio-bass"),
        active: level("--radio-analysis-active") >= 0.5
      });
    };

    const audioTimer = setInterval(sendAudio, 33);

    sendTheme();
    sendAudio();

    return () => {
      post("QFT_DISPOSE");
      abort.abort();
      observer.disconnect();
      clearInterval(audioTimer);
      cancelAnimationFrame(pointerFrame);
    };
  }, [suspended]);

  if (suspended) return null;

  return (
    <div className="qft-original-backdrop" aria-hidden>
      <iframe
        ref={frame}
        className="qft-original-frame"
        title="Quantum Fields visualizer"
        tabIndex={-1}
        srcDoc={source}
      />
    </div>
  );
}
