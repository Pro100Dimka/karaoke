import { useEffect, useRef, useState } from "react";

import { FIELD_TYPES } from "./qftConfig";

const GROUPS = [
  {
    title: "🌌 Environment",
    controls: [
      ["spaceNebula", "Space Nebula", "check"],
      ["nebulaIntensity", "Nebula Intensity", "range", 0, 2, 0.01],
      ["forceNetwork", "Force Network", "check"],
      ["networkRange", "Network Range", "range", 5, 25, 0.1],
      ["networkOpacity", "Network Opacity", "range", 0.1, 1, 0.01],
      ["networkCrawlers", "Network Crawlers", "check"],
      ["particleTrails", "Star Trails", "check"],
      ["trailOpacity", "Star Trail Opacity", "range", 0, 1, 0.01]
    ]
  },
  {
    title: "🎥 Camera & Lens",
    controls: [
      ["lensFlare", "Lens Flare", "check"],
      ["flareIntensity", "Flare Intensity", "range", 0, 2, 0.01],
      ["depthOfField", "Depth of Field", "check"],
      ["focusRing", "Focus Ring", "range", 0, 1, 0.001],
      ["focusFalloff", "Focus Falloff", "range", 0.05, 1, 0.01],
      ["blurAmount", "Blur Amount", "range", 0, 1, 0.01],
      ["cameraShake", "Camera Shake", "range", 0, 1, 0.01]
    ]
  },
  {
    title: "✨ Post Processing",
    controls: [
      ["bloom", "Bloom", "range", 0, 3, 0.01],
      ["motionBlur", "Motion Blur", "range", 0, 0.98, 0.01],
      ["chromaticAberration", "Chromatic", "range", 0, 0.02, 0.0001],
      ["anamorphicStretch", "Anamorphic", "range", 0, 1, 0.01],
      ["godRays", "God Rays", "check"],
      ["godRaysIntensity", "Rays Intensity", "range", 0, 1, 0.01],
      ["filmGrain", "Film Grain", "range", 0, 0.2, 0.001]
    ]
  },
  {
    title: "⚙️ Physics",
    controls: [
      ["vortex", "Vortex", "range", 0, 1, 0.01],
      ["pulseIntensity", "Pulse", "range", 0, 2.5, 0.01],
      ["bassImpact", "Line Bass Response", "range", 0, 5, 0.01],
      ["bassScaleStrength", "Bass 3D Scale", "range", 0, 0.15, 0.001],
      ["highSurfaceStrength", "High Surface", "range", 0, 8, 0.01]
    ]
  },
  {
    title: "🎤 Audio Gate",
    controls: [
      ["bassGateEnabled", "Enable", "check"],
      ["bassGateThreshold", "Threshold", "range", 0, 0.5, 0.001],
      ["bassGateAttack", "Attack", "range", 0.01, 0.3, 0.01],
      ["bassGateRelease", "Release", "range", 0.05, 0.5, 0.01]
    ]
  },
  {
    title: "🚀 Enhancement Pack",
    controls: [
      ["onsetSensitivity", "Onset Punch", "range", 0.5, 3, 0.01],
      ["audioCamera", "Audio Camera", "check"],
      ["audioCameraIntensity", "Camera React", "range", 0, 1, 0.01],
      ["terrainHeight", "Terrain Height", "range", 5, 30, 0.1],
      ["adaptiveQuality", "Auto Quality", "check"],
      ["targetFPS", "Target FPS", "range", 30, 60, 1]
    ]
  }
];

const formatTime = (seconds) => {
  if (!Number.isFinite(seconds)) return "0:00";
  const whole = Math.max(0, Math.floor(seconds));
  return `${Math.floor(whole / 60)}:${String(whole % 60).padStart(2, "0")}`;
};

function Setting({ item, value, onChange }) {
  const [key, label, type, min, max, step] = item;
  if (type === "check") {
    return (
      <label className="qft-setting qft-setting--check">
        <span>{label}</span>
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(event) => onChange(key, event.target.checked)}
        />
      </label>
    );
  }
  return (
    <label className="qft-setting">
      <span>{label}</span>
      <span className="qft-range-wrap">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(event) => onChange(key, Number(event.target.value))}
        />
        <output>{Number(value).toFixed(step < 0.01 ? 3 : step < 1 ? 2 : 0)}</output>
      </span>
    </label>
  );
}

export default function QuantumFieldControls({ settings, onSettingsChange, fpsRef }) {
  const [open, setOpen] = useState(false);
  const [entered, setEntered] = useState(false);
  const [audio, setAudio] = useState(null);
  const [audioUrl, setAudioUrl] = useState("");
  const [playing, setPlaying] = useState(false);
  const [trackName, setTrackName] = useState("no track");
  const [time, setTime] = useState({ current: 0, duration: 0 });
  const [status, setStatus] = useState("ready · awaiting input");
  const [, setFpsTick] = useState(0);
  const fileRef = useRef(null);
  const audioRef = useRef(null);
  const analysisRef = useRef(null);
  const audioUrlRef = useRef("");

  useEffect(() => {
    const timer = window.setInterval(() => setFpsTick((value) => value + 1), 800);
    return () => window.clearInterval(timer);
  }, []);

  const stopAnalysis = () => {
    const active = analysisRef.current;
    if (!active) return;
    window.cancelAnimationFrame(active.raf);
    active.stream?.getTracks().forEach((track) => track.stop());
    active.context.close().catch(() => {});
    analysisRef.current = null;
    window.qftLocalSpectrum = null;
  };

  const startAnalysis = async ({ element, stream }) => {
    stopAnalysis();
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (!AudioContext) throw new Error("Web Audio API is unavailable");
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 4096;
    analyser.smoothingTimeConstant = 0.65;
    const source = element
      ? context.createMediaElementSource(element)
      : context.createMediaStreamSource(stream);
    source.connect(analyser);
    if (element) analyser.connect(context.destination);
    const bins = new Uint8Array(analyser.frequencyBinCount);
    const root = document.documentElement;
    const updateBands = () => {
      analyser.getByteFrequencyData(bins);
      const nyquist = context.sampleRate / 2;
      const bandValues = [];
      for (let band = 0; band < 18; band += 1) {
        const lowHz = 45 * (20000 / 45) ** (band / 18);
        const highHz = 45 * (20000 / 45) ** ((band + 1) / 18);
        const low = Math.max(0, Math.floor((lowHz / nyquist) * bins.length));
        const high = Math.min(
          bins.length,
          Math.max(low + 1, Math.ceil((highHz / nyquist) * bins.length))
        );
        let sum = 0;
        for (let index = low; index < high; index += 1) sum += bins[index];
        const value = Math.min(1, sum / Math.max(1, high - low) / 190);
        bandValues.push(value);
        root.style.setProperty(`--radio-band-${band}`, value.toFixed(4));
      }
      root.style.setProperty("--radio-bass", Math.max(...bandValues.slice(0, 4), 0).toFixed(4));
      window.qftLocalSpectrum = bandValues;
      if (analysisRef.current) {
        analysisRef.current.raf = window.requestAnimationFrame(updateBands);
      }
    };
    analysisRef.current = { context, raf: 0, stream };
    await context.resume();
    updateBands();
  };

  useEffect(() => {
    audioRef.current = audio;
  }, [audio]);

  useEffect(
    () => () => {
      stopAnalysis();
      const currentAudio = audioRef.current;
      if (currentAudio) {
        currentAudio.pause();
        currentAudio.src = "";
      }
      if (audioUrlRef.current) URL.revokeObjectURL(audioUrlRef.current);
      for (let band = 0; band < 18; band += 1) {
        document.documentElement.style.removeProperty(`--radio-band-${band}`);
      }
      document.documentElement.style.removeProperty("--radio-bass");
    },
    []
  );

  const update = (key, value) => onSettingsChange({ ...settings, [key]: value });

  const enter = async () => {
    setEntered(true);
    setStatus("live · using app audio analyser");
  };

  const chooseFile = (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    if (audio) audio.pause();
    const url = URL.createObjectURL(file);
    audioUrlRef.current = url;
    const element = new Audio(url);
    element.addEventListener("timeupdate", () =>
      setTime({ current: element.currentTime, duration: element.duration || 0 })
    );
    element.addEventListener("ended", () => setPlaying(false));
    startAnalysis({ element })
      .then(() => element.play())
      .then(() => setPlaying(true))
      .catch(() => setPlaying(false));
    setAudioUrl(url);
    setAudio(element);
    setEntered(true);
    setTrackName(file.name);
    setStatus("file · audio playback active");
  };

  const startMicrophone = async () => {
    try {
      if (audio) audio.pause();
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      await startAnalysis({ stream });
      setAudio(null);
      setPlaying(false);
      setEntered(true);
      setTrackName("microphone");
      setStatus("live · microphone input active");
    } catch (error) {
      setStatus(`error · ${error?.message || "microphone unavailable"}`);
    }
  };

  const togglePlayback = () => {
    if (!audio) return;
    if (audio.paused) {
      audio
        .play()
        .then(() => setPlaying(true))
        .catch(() => {});
    } else {
      audio.pause();
      setPlaying(false);
    }
  };

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.code !== "Space" || !audioRef.current) return;
      event.preventDefault();
      const element = audioRef.current;
      if (element.paused) {
        element
          .play()
          .then(() => setPlaying(true))
          .catch(() => {});
      } else {
        element.pause();
        setPlaying(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const seek = (event) => {
    if (!audio || !audio.duration) return;
    const rect = event.currentTarget.getBoundingClientRect();
    audio.currentTime = ((event.clientX - rect.left) / rect.width) * audio.duration;
  };

  const screenshot = () => {
    const canvas = document.querySelector(".qft-stage canvas");
    if (!canvas) return;
    const link = document.createElement("a");
    link.download = `quantum-field-${Date.now()}.png`;
    link.href = canvas.toDataURL("image/png");
    link.click();
  };

  const toggleFullscreen = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else document.querySelector(".qft-backdrop-root")?.requestFullscreen?.();
  };

  return (
    <>
      <div className="qft-interaction-hint">
        space · play/pause &nbsp;·&nbsp; scroll · zoom &nbsp;·&nbsp; drag · rotate &nbsp;·&nbsp; F ·
        focus mode
      </div>
      <button className="qft-configure" type="button" onClick={() => setOpen((value) => !value)}>
        ✦ Configure
      </button>
      <aside className={`qft-controls ${open ? "is-open" : ""}`}>
        <div className="qft-controls__title">✦ Quantum Fields</div>
        <label className="qft-setting">
          <span>⚡ Field Type</span>
          <select
            value={settings.fieldType}
            onChange={(event) => update("fieldType", event.target.value)}
          >
            {Object.keys(FIELD_TYPES).map((name) => (
              <option key={name}>{name}</option>
            ))}
          </select>
        </label>
        <Setting
          item={["sensitivity", "🎧 Audio Sensitivity", "range", 0.1, 3, 0.01]}
          value={settings.sensitivity}
          onChange={update}
        />
        <Setting
          item={["density", "⭐ Star Density", "range", 0.017, 0.14, 0.001]}
          value={settings.density}
          onChange={update}
        />
        <Setting
          item={["particleSize", "✦ Star Size", "range", 0.15, 1.5, 0.01]}
          value={settings.particleSize}
          onChange={update}
        />
        <Setting
          item={["viewportFill", "↔ Screen Fill", "range", 0.8, 1.5, 0.01]}
          value={settings.viewportFill}
          onChange={update}
        />
        <Setting
          item={["timeFlow", "⏱ Time Flow", "range", 0, 3, 0.01]}
          value={settings.timeFlow}
          onChange={update}
        />
        {GROUPS.map((group) => (
          <details key={group.title}>
            <summary>{group.title}</summary>
            {group.controls.map((item) => (
              <Setting key={item[0]} item={item} value={settings[item[0]]} onChange={update} />
            ))}
            {group.title.includes("Enhancement") && (
              <div className="qft-setting qft-fps">
                <span>Current FPS</span>
                <output>{fpsRef.current.toFixed(1)}</output>
              </div>
            )}
          </details>
        ))}
      </aside>

      {!entered && (
        <div className="qft-enter-overlay">
          <div className="qft-enter-card">
            <button type="button" onClick={enter}>
              Enter
            </button>
          </div>
        </div>
      )}

      {entered && (
        <div className="qft-audio-controls">
          <button
            type="button"
            className={playing ? "is-playing" : ""}
            onClick={togglePlayback}
            disabled={!audio}
          >
            {playing ? "⏸ pause" : "▶ play"}
          </button>
          <button className="qft-progress" type="button" onClick={seek} aria-label="Seek">
            <span
              style={{ width: `${time.duration ? (time.current / time.duration) * 100 : 0}%` }}
            />
          </button>
          <span>
            {formatTime(time.current)} / {formatTime(time.duration)}
          </span>
          <span className="qft-track">{trackName}</span>
          <button type="button" title="Load audio" onClick={() => fileRef.current?.click()}>
            📁
          </button>
          <input ref={fileRef} hidden type="file" accept="audio/*" onChange={chooseFile} />
          <button type="button" title="Microphone" onClick={startMicrophone}>
            🎙
          </button>
          <button type="button" title="Screenshot" onClick={screenshot}>
            📷
          </button>
          <button type="button" title="Fullscreen" onClick={toggleFullscreen}>
            ⛶
          </button>
        </div>
      )}
      <div className="qft-status">
        <span>{status.split(" · ")[0]}</span>
        {status.includes(" · ") ? ` · ${status.split(" · ").slice(1).join(" · ")}` : ""}
      </div>
      <div className="qft-zoom">drag · rotate &nbsp; / &nbsp; wheel · zoom</div>
    </>
  );
}
