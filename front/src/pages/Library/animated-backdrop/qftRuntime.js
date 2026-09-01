/* eslint-disable */
import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
// BokehPass removed - using custom DOF shader
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { Lensflare, LensflareElement } from "three/addons/objects/Lensflare.js";
import GUI from "three/examples/jsm/libs/lil-gui.module.min.js";

const CONFIG = {
  maxParticles: 250000,
  secondaryParticles: 50000,
  initialDensity: 0.017,
  fieldRadius: 90,
  minZoom: 1,
  maxZoom: 250,
  defaultZoom: 88
};

const STATE = {
  field: "Neutrino",
  density: CONFIG.initialDensity,
  sensitivity: 1.1,
  trails: 0.5,
  bloom: 0.6074502496953552,
  timeScale: 1.311,
  pixelRatio: 1.75,
  chromaticAberration: 0,
  filmGrain: 0.001,
  cameraShake: 2,
  vortexStrength: 0,
  pulseIntensity: 0.15,
  anamorphicStretch: 0,
  bassGateThreshold: 0.12,
  bassGateAttack: 0.3,
  bassGateRelease: 0.136,
  bassGateRatio: 2.142,
  bassGateEnabled: false,
  // NEW EFFECTS
  godRaysEnabled: false,
  godRaysIntensity: 0,
  godRaysDecay: 0.92,
  dofEnabled: true,
  dofFocus: 0,
  dofFocalLength: 0.05,
  dofBokehStrength: 0,
  lensFlareEnabled: false,
  lensFlareIntensity: 2,
  particleTrailsEnabled: true,
  particleTrailOpacity: 1,
  nebulaEnabled: false,
  nebulaIntensity: 0.246,
  connectionsEnabled: true,
  connectionThreshold: 5,
  connectionOpacity: 1,
  // === ENHANCEMENT PACK v2.0 ===
  // 1. Motion Blur
  motionBlurEnabled: true,
  motionBlurStrength: 0.1,
  // 2. Adaptive Quality
  adaptiveQualityEnabled: false,
  targetFPS: 60,
  qualityLevel: 1.1,
  // 3. Onset Detection
  onsetSensitivity: 1,
  onsetDecay: 0.92,
  // 4. Audio-Reactive Camera
  audioCameraEnabled: true,
  audioCameraSmoothing: 0.2,
  audioCameraIntensity: 0.12,
  // 5. Waveform Terrain
  waveformTerrainScale: 1.0,
  waveformTerrainHeight: 20.0
};

let disposed = false;
const lifecycleListeners = [];
const scheduledFrames = new Set();
const listen = (target, type, handler, options) => {
  if (!target?.addEventListener) return;
  target.addEventListener(type, handler, options);
  lifecycleListeners.push([target, type, handler, options]);
};
const scheduleFrame = (callback) => {
  if (disposed) return 0;
  const id = requestAnimationFrame((timestamp) => {
    scheduledFrames.delete(id);
    if (!disposed) callback(timestamp);
  });
  scheduledFrames.add(id);
  return id;
};

// --- AUDIO SYSTEM ---
const AUDIO = {
  ctx: null,
  analyser: null,
  source: null,
  gainNode: null,
  data: null,
  audioBuffer: null,
  isPlaying: false,
  isPaused: false,
  startTime: 0,
  pauseTime: 0,
  currentTrackName: "No Track",
  mode: null,
  micStream: null,
  external: false,
  bands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, high: 0, ultraHigh: 0 },
  gatedBands: { subBass: 0, bass: 0, lowMid: 0, mid: 0, highMid: 0, high: 0, ultraHigh: 0 },
  beatThreshold: 0.15,
  beatDecay: 0.93,
  beatEnergy: 0,
  lastBeatTime: 0,
  beatDetected: false,
  peakHistory: [],
  spectralCentroid: 0,
  spectralFlux: 0,
  prevSpectrum: null,
  active: false,
  // === ENHANCEMENT: Onset Detection ===
  onsetEnergy: 0,
  onsetDetected: false,
  onsetHistory: [],
  onsetThreshold: 0,
  // === ENHANCEMENT: Waveform Data ===
  waveformData: new Float32Array(128),
  waveformSmoothed: new Float32Array(128),
  gateState: {
    isOpen: false,
    envelope: 0,
    holdTime: 0,
    noiseFloor: 0.05,
    calibrationSamples: [],
    isCalibrating: true,
    calibrationFrames: 30
  },

  init() {
    if (this.ctx) return;
    this.ctx = new (window.AudioContext || window.webkitAudioContext)();
    this.analyser = this.ctx.createAnalyser();
    this.analyser.fftSize = 4096;
    this.analyser.smoothingTimeConstant = 0.65;
    this.data = new Uint8Array(this.analyser.frequencyBinCount);
    this.prevSpectrum = new Float32Array(this.analyser.frequencyBinCount);
    this.active = true;
  },

  loadTrack(arrayBuffer, fileName) {
    return new Promise((resolve, reject) => {
      this.ctx.decodeAudioData(
        arrayBuffer,
        (buffer) => {
          this.stopCurrentSource();
          this.audioBuffer = buffer;
          this.currentTrackName = fileName || "Unknown";
          this.mode = "file";
          this.pauseTime = 0;
          this.resetCalibration();
          resolve(buffer);
        },
        reject
      );
    });
  },

  play() {
    if (!this.audioBuffer || this.mode !== "file" || this.isPlaying) return;
    this.source = this.ctx.createBufferSource();
    this.source.buffer = this.audioBuffer;
    this.source.loop = true;
    this.source.connect(this.analyser);
    this.analyser.connect(this.ctx.destination);
    this.source.start(0, this.pauseTime);
    this.startTime = this.ctx.currentTime - this.pauseTime;
    this.isPlaying = true;
    this.isPaused = false;
  },

  pause() {
    if (!this.isPlaying || this.mode !== "file") return;
    this.pauseTime = this.getCurrentTime();
    this.isPaused = true;
    this.isPlaying = false;
    if (this.source) {
      try {
        this.source.stop();
      } catch (e) {}
      this.source.disconnect();
      this.source = null;
    }
  },

  togglePlayPause() {
    if (this.mode === "mic") return false;
    if (this.isPlaying) {
      this.pause();
      return false;
    } else {
      this.play();
      return true;
    }
  },

  getCurrentTime() {
    if (!this.isPlaying) return this.pauseTime;
    if (!this.audioBuffer) return 0;
    return (this.ctx.currentTime - this.startTime) % this.audioBuffer.duration;
  },

  getDuration() {
    return this.audioBuffer ? this.audioBuffer.duration : 0;
  },

  seek(time) {
    if (this.mode !== "file" || !this.audioBuffer) return;
    const wasPlaying = this.isPlaying;
    if (wasPlaying) this.pause();
    this.pauseTime = Math.max(0, Math.min(time, this.audioBuffer.duration));
    if (wasPlaying) this.play();
  },

  stopCurrentSource() {
    if (this.source) {
      try {
        this.source.stop();
        this.source.disconnect();
      } catch (e) {}
      this.source = null;
    }
    if (this.gainNode) {
      try {
        this.gainNode.disconnect();
      } catch (e) {}
      this.gainNode = null;
    }
    if (this.micStream) {
      this.micStream.getTracks().forEach((t) => t.stop());
      this.micStream = null;
    }
    this.isPlaying = false;
    this.isPaused = false;
    this.pauseTime = 0;
  },

  async startMic(preferredLabel = null) {
    console.log("startMic called with preferredLabel:", preferredLabel);
    const status = document.getElementById("status-bar");
    if (status) status.innerHTML = "SYSTEM: <span>REQUESTING ACCESS...</span>";

    try {
      // Ensure context is running
      if (this.ctx.state === "suspended") {
        console.log("Resuming AudioContext...");
        await this.ctx.resume();
      }

      // 1. Get initial stream (activates permissions so labels are visible)
      console.log("Requesting initial getUserMedia...");
      let stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      console.log("Initial stream obtained:", stream.id);

      // 2. Search for preferred device (loopback)
      let target = null;
      if (preferredLabel) {
        const devices = await navigator.mediaDevices.enumerateDevices();
        console.log(
          "Audio Devices Found:",
          devices.length,
          devices.map((d) => `${d.label} (${d.kind})`)
        );

        target = devices.find(
          (d) =>
            d.kind === "audioinput" && d.label.toLowerCase().includes(preferredLabel.toLowerCase())
        );
      }

      if (target) {
        console.log(`Switching audio input to: ${target.label} [${target.deviceId}]`);
        stream.getTracks().forEach((t) => t.stop()); // Stop generic stream

        // Request specific device - being explicit with constraints
        stream = await navigator.mediaDevices.getUserMedia({
          audio: {
            deviceId: { exact: target.deviceId },
            echoCancellation: false,
            noiseSuppression: false,
            autoGainControl: false,
            channelCount: 2
          }
        });
        this.currentTrackName = target.label;
      } else {
        if (preferredLabel)
          console.warn(`Preferred device '${preferredLabel}' not found. Using default.`);
        // Keep the initial stream
        this.currentTrackName = stream.getAudioTracks()[0]?.label || "Live Microphone";
      }

      this.stopCurrentSource();
      this.micStream = stream;
      this.source = this.ctx.createMediaStreamSource(stream);
      this.gainNode = this.ctx.createGain();
      this.gainNode.gain.value = 3.0; // Boost loopback/mic signal before FFT — tune via sensitivity slider
      this.source.connect(this.gainNode);
      this.gainNode.connect(this.analyser);
      this.mode = "mic";
      this.isPlaying = true;
      this.resetCalibration();

      if (status)
        status.innerHTML =
          "SYSTEM: <span>LISTENING (" + (preferredLabel ? "Loopback" : "Mic") + ")</span>";
      updateUI();

      return stream;
    } catch (e) {
      console.error("AUDIO.startMic failed:", e);
      throw e;
    }
  },

  resetCalibration() {
    this.gateState.isCalibrating = true;
    this.gateState.calibrationSamples = [];
  },

  applyExternalSpectrum(levels, radioBass, isActive) {
    if (!isActive || !Array.isArray(levels) || levels.length < 18) {
      document.documentElement.dataset.qftAudioActive = "0";
      document.documentElement.dataset.qftBass = "0";
      this.external = false;
      this.active = false;
      this.mode = null;
      this.isPlaying = false;
      Object.keys(this.bands).forEach((band) => {
        this.bands[band] = 0;
        this.gatedBands[band] = 0;
      });
      this.beatDetected = false;
      this.beatEnergy = 0;
      this.onsetDetected = false;
      this.onsetEnergy = 0;
      this.spectralCentroid = 0;
      this.spectralFlux = 0;
      return;
    }

    const average = (from, to) => {
      let sum = 0;
      for (let i = from; i <= to; i++) sum += THREE.MathUtils.clamp(Number(levels[i]) || 0, 0, 1);
      return sum / (to - from + 1);
    };
    const previous = { ...this.bands };
    const mapped = {
      subBass: average(0, 1),
      bass: Math.max(average(2, 4), THREE.MathUtils.clamp(Number(radioBass) || 0, 0, 1)),
      lowMid: average(5, 6),
      mid: average(7, 11),
      highMid: average(12, 13),
      high: average(14, 16),
      ultraHigh: average(17, 17)
    };

    this.external = true;
    this.active = true;
    this.mode = "external";
    this.isPlaying = true;
    document.documentElement.dataset.qftAudioActive = "1";
    document.documentElement.dataset.qftBass = mapped.bass.toFixed(3);
    Object.entries(mapped).forEach(([band, value]) => {
      this.bands[band] = value;
      this.gatedBands[band] =
        band === "subBass" || band === "bass" || band === "lowMid"
          ? this.applyBassGate(value)
          : value;
    });

    const bandValues = Object.values(mapped);
    const total = bandValues.reduce((sum, value) => sum + value, 0);
    this.spectralCentroid =
      total > 0
        ? bandValues.reduce((sum, value, index) => sum + value * index, 0) /
          total /
          (bandValues.length - 1)
        : 0;
    const positiveFlux = Object.keys(mapped).reduce((sum, band) => {
      const rise = mapped[band] - previous[band];
      return sum + (rise > 0 ? rise * rise : 0);
    }, 0);
    this.spectralFlux = Math.sqrt(positiveFlux / bandValues.length);

    // Percussive transient detector: kick (lows), clap/snare (mids), tick/hat (highs).
    const kickRise =
      Math.max(0, mapped.subBass - previous.subBass) * 0.7 +
      Math.max(0, mapped.bass - previous.bass);
    const clapRise =
      Math.max(0, mapped.lowMid - previous.lowMid) * 0.45 +
      Math.max(0, mapped.mid - previous.mid) * 0.7 +
      Math.max(0, mapped.highMid - previous.highMid);
    const tickRise =
      Math.max(0, mapped.highMid - previous.highMid) * 0.35 +
      Math.max(0, mapped.high - previous.high) +
      Math.max(0, mapped.ultraHigh - previous.ultraHigh) * 0.8;
    const transientScore =
      Math.max(kickRise * 4.5, clapRise * 5.5, tickRise * 7.0, this.spectralFlux * 5.0) *
      STATE.sensitivity;

    const currentEnergy = mapped.subBass * 0.35 + mapped.bass * 0.65;
    this.peakHistory.push(currentEnergy);
    if (this.peakHistory.length > 45) this.peakHistory.shift();
    const averageEnergy =
      this.peakHistory.reduce((sum, value) => sum + value, 0) / this.peakHistory.length;
    const variance =
      this.peakHistory.reduce((sum, value) => sum + Math.pow(value - averageEnergy, 2), 0) /
      this.peakHistory.length;
    const kickThreshold = Math.max(0.075, averageEnergy + Math.sqrt(variance) * 1.15);
    const now = performance.now();
    const adaptiveKick = currentEnergy > kickThreshold && kickRise > 0.012;
    const percussiveHit = transientScore > 0.08;
    const hitCooldown = kickRise * 4.5 >= Math.max(clapRise * 5.5, tickRise * 7.0) ? 85 : 45;
    if ((adaptiveKick || percussiveHit) && now - this.lastBeatTime > hitCooldown) {
      const hitStrength = THREE.MathUtils.clamp(
        transientScore * 3.2 + (adaptiveKick ? 0.3 : 0),
        0.3,
        1
      );
      this.beatDetected = true;
      this.beatEnergy = Math.max(this.beatEnergy, hitStrength);
      this.lastBeatTime = now;
    } else {
      this.beatDetected = false;
    }

    this.onsetDetected = percussiveHit;
    this.onsetEnergy = this.onsetDetected
      ? Math.max(this.onsetEnergy, THREE.MathUtils.clamp(transientScore * 3.5, 0.35, 1))
      : this.onsetEnergy * STATE.onsetDecay;
  },

  applyBassGate(rawValue) {
    if (!STATE.bassGateEnabled) return rawValue;
    const {
      bassGateThreshold: threshold,
      bassGateAttack: attack,
      bassGateRelease: release,
      bassGateRatio: ratio
    } = STATE;
    if (this.gateState.isCalibrating) {
      this.gateState.calibrationSamples.push(rawValue);
      if (this.gateState.calibrationSamples.length >= this.gateState.calibrationFrames) {
        const sorted = [...this.gateState.calibrationSamples].sort((a, b) => a - b);
        this.gateState.noiseFloor =
          sorted.slice(0, Math.floor(sorted.length * 0.2)).reduce((a, b) => a + b, 0) /
          Math.floor(sorted.length * 0.2);
        this.gateState.isCalibrating = false;
      }
    }
    const effectiveThreshold = Math.max(threshold, this.gateState.noiseFloor * 1.5);
    if (rawValue > effectiveThreshold) {
      this.gateState.isOpen = true;
      this.gateState.holdTime = 10;
    } else if (rawValue < effectiveThreshold * 0.7 && this.gateState.holdTime <= 0) {
      this.gateState.isOpen = false;
    }
    if (this.gateState.holdTime > 0) this.gateState.holdTime--;
    this.gateState.envelope +=
      ((this.gateState.isOpen ? 1.0 : 0.0) - this.gateState.envelope) *
      (this.gateState.isOpen ? attack : release);
    let output = rawValue;
    if (this.gateState.isOpen && rawValue > effectiveThreshold) {
      output = effectiveThreshold + (rawValue - effectiveThreshold) / ratio;
    }
    return output * this.gateState.envelope;
  },

  update() {
    if (this.external) {
      this.beatEnergy *= this.beatDecay;
      if (!this.onsetDetected) this.onsetEnergy *= STATE.onsetDecay;
      return;
    }
    if (!this.active) return;
    this.analyser.getByteFrequencyData(this.data);
    const len = this.data.length,
      nyquist = this.ctx.sampleRate / 2;
    const getFreqIndex = (freq) => Math.round((freq / nyquist) * len);
    const ranges = {
      subBass: [50, 120],
      bass: [120, 200],
      lowMid: [200, 450],
      mid: [450, 2000],
      highMid: [2000, 3500],
      high: [3500, 12000],
      ultraHigh: [12000, 20000]
    };
    let totalEnergy = 0,
      weightedFreqSum = 0;
    for (const [band, [low, high]] of Object.entries(ranges)) {
      const lowIdx = getFreqIndex(low),
        highIdx = getFreqIndex(high);
      let sum = 0;
      for (let i = lowIdx; i < highIdx && i < len; i++) {
        const v = this.data[i] / 255.0;
        sum += v;
        totalEnergy += v;
        weightedFreqSum += v * i;
      }
      const rawBand = sum / (highIdx - lowIdx);
      this.bands[band] = rawBand;
      this.gatedBands[band] =
        band === "subBass" || band === "bass" || band === "lowMid"
          ? this.applyBassGate(rawBand)
          : rawBand;
    }
    this.spectralCentroid = totalEnergy > 0 ? weightedFreqSum / totalEnergy / len : 0;
    let flux = 0;
    for (let i = 0; i < len; i++) {
      const current = this.data[i] / 255.0,
        diff = current - this.prevSpectrum[i];
      flux += diff > 0 ? diff * diff : 0;
      this.prevSpectrum[i] = current;
    }
    this.spectralFlux = Math.sqrt(flux / len);
    const currentEnergy = this.gatedBands.bass * 0.6 + this.gatedBands.subBass * 0.4;
    this.peakHistory.push(currentEnergy);
    if (this.peakHistory.length > 50) this.peakHistory.shift();
    const avgEnergy = this.peakHistory.reduce((a, b) => a + b, 0) / this.peakHistory.length;
    const variance =
      this.peakHistory.reduce((a, b) => a + Math.pow(b - avgEnergy, 2), 0) /
      this.peakHistory.length;
    const dynamicThreshold = avgEnergy + Math.sqrt(variance) * 1.8;
    const now = performance.now();
    if (
      currentEnergy > dynamicThreshold &&
      currentEnergy > this.beatThreshold &&
      now - this.lastBeatTime > 120
    ) {
      this.beatDetected = true;
      this.beatEnergy = 1.0;
      this.lastBeatTime = now;
    } else {
      this.beatDetected = false;
    }
    this.beatEnergy *= this.beatDecay;

    // === ENHANCEMENT: Improved Onset Detection ===
    // Uses spectral flux derivative for sharper transient response
    const onsetSens = STATE.onsetSensitivity;
    this.onsetHistory.push(this.spectralFlux);
    if (this.onsetHistory.length > 8) this.onsetHistory.shift();
    const recentAvg = this.onsetHistory.slice(-4).reduce((a, b) => a + b, 0) / 4;
    const olderAvg =
      this.onsetHistory.slice(0, 4).reduce((a, b) => a + b, 0) /
      Math.max(1, this.onsetHistory.slice(0, 4).length);
    const onsetDelta = (recentAvg - olderAvg) * onsetSens;
    this.onsetDetected = onsetDelta > 0.015 && now - this.lastBeatTime > 50;
    this.onsetEnergy = this.onsetDetected ? 1.0 : this.onsetEnergy * STATE.onsetDecay;

    // === ENHANCEMENT: Waveform Data for Terrain Field ===
    const waveformBins = 128;
    const binSize = Math.floor(len / waveformBins);
    for (let i = 0; i < waveformBins; i++) {
      let sum = 0;
      for (let j = 0; j < binSize; j++) {
        sum += this.data[i * binSize + j] / 255.0;
      }
      const target = sum / binSize;
      this.waveformSmoothed[i] += (target - this.waveformSmoothed[i]) * 0.3;
      this.waveformData[i] = this.waveformSmoothed[i];
    }
  }
};

// --- SCENE SETUP ---
const scene = new THREE.Scene();
scene.fog = new THREE.FogExp2(0x000508, 0.005);
const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 800);
camera.position.set(0, 12, CONFIG.defaultZoom);
const cameraShakeOffset = new THREE.Vector3();
const baseCameraPos = camera.position.clone();
const zoomIndicator = document.getElementById("zoom-level");

const renderer = new THREE.WebGLRenderer({
  powerPreference: "high-performance",
  antialias: true,
  alpha: true
});
renderer.setClearColor(0x000000, 0);
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(STATE.pixelRatio);
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 2.1;
const themeBackdrop = document.createElement("div");
Object.assign(themeBackdrop.style, {
  position: "fixed",
  inset: "-4vh -4vw",
  zIndex: "0",
  pointerEvents: "none",
  backgroundPosition: "center",
  backgroundSize: "cover",
  backgroundRepeat: "no-repeat",
  transform: "translate3d(0, 0, 0) scale(1.055)",
  transformOrigin: "center",
  willChange: "transform"
});
document.body.prepend(themeBackdrop);
renderer.domElement.style.position = "relative";
renderer.domElement.style.zIndex = "1";
document.body.appendChild(renderer.domElement);

let backdropX = 0;
let backdropY = 0;
let backdropTargetX = 0;
let backdropTargetY = 0;

const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.autoRotate = true;
controls.autoRotateSpeed = 0.3;
controls.minDistance = CONFIG.minZoom;
controls.maxDistance = CONFIG.maxZoom;
controls.maxPolarAngle = Math.PI * 0.85;
controls.minPolarAngle = Math.PI * 0.15;

listen(controls, "change", () => {
  const dist = camera.position.length();
  const zoomPercent = Math.round(
    (1 - (dist - CONFIG.minZoom) / (CONFIG.maxZoom - CONFIG.minZoom)) * 100
  );
  if (zoomIndicator) zoomIndicator.textContent = Math.max(0, Math.min(100, zoomPercent)) + "%";
  baseCameraPos.copy(camera.position);
});

const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2(9999, 9999);
const plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
const mouseWorldPos = new THREE.Vector3();
let mouseVelocity = new THREE.Vector2();
let prevMouse = new THREE.Vector2();

listen(window, "mousemove", (e) => {
  const newMouse = new THREE.Vector2(
    (e.clientX / window.innerWidth) * 2 - 1,
    -(e.clientY / window.innerHeight) * 2 + 1
  );
  mouseVelocity.subVectors(newMouse, prevMouse);
  prevMouse.copy(newMouse);
  mouse.copy(newMouse);
  raycaster.setFromCamera(mouse, camera);
  const target = new THREE.Vector3();
  raycaster.ray.intersectPlane(plane, target);
  if (target) mouseWorldPos.copy(target);
});

listen(window, "keydown", (e) => {
  if (e.key === "+" || e.key === "=") {
    camera.position.multiplyScalar(0.9);
    controls.update();
  } else if (e.key === "-" || e.key === "_") {
    camera.position.multiplyScalar(1.1);
    controls.update();
  } else if (e.key === "0") {
    camera.position.normalize().multiplyScalar(CONFIG.defaultZoom);
    controls.update();
  } else if (e.key === " ") {
    e.preventDefault();
    togglePlayPause();
  } else if (e.key === "f" || e.key === "F") {
    STATE.dofEnabled = !STATE.dofEnabled;
    customDOFPass.enabled = STATE.dofEnabled;
    if (dofController) dofController.updateDisplay();
  }
});

// --- PARTICLE VERTEX SHADER ---
const vertexShader = `
uniform float uTime, uPixelRatio, uSizeBase, uNoiseScale, uCurlStrength, uRadius;
uniform vec3 uColor1, uColor2, uColor3;
uniform float uSubBass, uBass, uLowMid, uMid, uHighMid, uHigh, uUltraHigh;
uniform float uBeatEnergy, uSpectralCentroid, uSpectralFlux;
uniform float uOnsetEnergy, uTerrainMode, uTerrainHeight;
uniform float uVortexStrength, uPulseIntensity, uZoomFactor, uAudioActivity;
uniform vec3 uMousePos;
uniform vec2 uMouseVelocity;
attribute vec3 aRandom;
attribute float aPhase, aLayer;
varying vec3 vColor;
varying float vAlpha, vEnergy, vDepth, vRimLight;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

vec3 curl(float x, float y, float z) {
    float eps = 0.08;
    return vec3(
        snoise(vec3(x, y+eps, z)) - snoise(vec3(x, y-eps, z)),
        snoise(vec3(x, y, z+eps)) - snoise(vec3(x, y, z-eps)),
        snoise(vec3(x+eps, y, z)) - snoise(vec3(x-eps, y, z))
    );
}

void main() {
    float t = uTime * (1.0 + uMid * 0.5);
    vec3 noisePos = position * 0.035 + aRandom;
    float layerMod = 1.0 + aLayer * 0.5;

    vec3 flow1 = curl(noisePos.x * uNoiseScale + t*0.1, noisePos.y * uNoiseScale, noisePos.z * uNoiseScale);
    vec3 flow2 = curl(noisePos.x * uNoiseScale * 2.2 + t*0.07, noisePos.y * uNoiseScale * 2.2 + t*0.08, noisePos.z * uNoiseScale * 2.2) * 0.4;
    vec3 flow3 = curl(noisePos.x * uNoiseScale * 0.5 - t*0.05, noisePos.y * uNoiseScale * 0.5, noisePos.z * uNoiseScale * 0.5) * 0.6 * uLowMid;
    vec3 flow = flow1 + flow2 * uHigh + flow3;

    vec3 newPos = position + (flow * uCurlStrength * layerMod * (1.0 + uSpectralFlux * 2.5));

    float distFromCenter = length(newPos.xz);
    float vortexAngle = uVortexStrength * uBass * 3.5 / (1.0 + distFromCenter * 0.08);
    float cosA = cos(vortexAngle), sinA = sin(vortexAngle);
    vec2 rotated = vec2(newPos.x * cosA - newPos.z * sinA, newPos.x * sinA + newPos.z * cosA);
    newPos.xz = mix(newPos.xz, rotated, uBass * uVortexStrength);

    float yVortex = sin(newPos.y * 0.1 + uTime) * uMid * uVortexStrength * 2.0;
    newPos.x += cos(newPos.y * 0.15) * yVortex;
    newPos.z += sin(newPos.y * 0.15) * yVortex;

    float distToMouse = distance(newPos, uMousePos);
    float repulsion = smoothstep(25.0, 0.0, distToMouse);
    vec3 repelDir = normalize(newPos - uMousePos + vec3(0.001));
    newPos += repelDir * repulsion * (12.0 + length(uMouseVelocity) * 360.0);

    float distToCenter = length(newPos);
    vec3 centerDir = normalize(newPos + vec3(0.001));

    float beatRing = sin(distToCenter * 0.25 - uTime * 6.0) * uBeatEnergy * uPulseIntensity;
    newPos += centerDir * beatRing * 2.0;

    float breathing = sin(uTime * 1.8 + aPhase) * uSubBass * 2.0;
    newPos += centerDir * breathing * exp(-distToCenter * 0.04);

    newPos += centerDir * smoothstep(0.3, 0.8, uBass) * 2.0 * exp(-distToCenter * 0.06);
    
    // === ENHANCEMENT: Onset Energy Punch ===
    float onsetPunch = uOnsetEnergy * 3.0 * exp(-distToCenter * 0.03);
    newPos += centerDir * onsetPunch;
    
    // === ENHANCEMENT: Waveform Terrain Mode ===
    if (uTerrainMode > 0.5) {
        // Convert to grid-like terrain formation
        float gridX = floor(position.x * 0.5 + 64.0) / 128.0;
        float gridZ = floor(position.z * 0.5 + 64.0) / 128.0;
        
        // Sample waveform based on position (simulate frequency bins)
        float freqBin = gridX;
        float waveHeight = uBass * sin(freqBin * 6.28 * 8.0 + uTime * 3.0) * 0.5;
        waveHeight += uMid * sin(freqBin * 6.28 * 16.0 + uTime * 5.0) * 0.3;
        waveHeight += uHigh * sin(freqBin * 6.28 * 32.0 + uTime * 8.0) * 0.2;
        
        // Modulate by spectral data
        waveHeight *= (1.0 + uSpectralFlux * 3.0);
        
        // Apply terrain displacement
        float terrainY = waveHeight * uTerrainHeight;
        terrainY += sin(gridZ * 6.28 * 4.0 + uTime) * uSubBass * 5.0;
        
        // Blend between sphere and terrain based on position
        float terrainBlend = smoothstep(0.0, 30.0, abs(position.y));
        newPos.y = mix(terrainY, newPos.y, terrainBlend);
        
        // Flatten to XZ plane for terrain effect
        newPos.xz = mix(vec2(gridX * 150.0 - 75.0, gridZ * 150.0 - 75.0), newPos.xz, terrainBlend * 0.3);
    }

    vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    float idleScale = mix(2.0, 1.0, uAudioActivity);
    float size = uSizeBase * 0.35 * idleScale * (0.85 + uBass * 0.18 + uBeatEnergy * 0.22) * (1.0 + (uZoomFactor - 1.0) * 0.3);
    size *= 1.0 + sin(uTime * 10.0 + aPhase * 6.28) * uHigh * 0.35;
    gl_PointSize = clamp(size * uPixelRatio * (90.0 / -mvPosition.z) * layerMod, 0.25, 6.0);

    float colorMix = smoothstep(0.0, 2.8, length(flow) + uHighMid * 3.0);
    vec3 baseColor = mix(uColor1, uColor2, colorMix);
    baseColor = mix(baseColor, uColor3, uSpectralCentroid * uHigh * 2.5);

    float energyLevel = uBeatEnergy * 0.35 + repulsion * uMid * 2.0 + uSpectralFlux * 0.8;
    vColor = mix(baseColor, vec3(1.0), energyLevel * 0.4);
    vColor += vec3(0.08, 0.04, 0.12) * uUltraHigh * 2.5;

    vRimLight = pow(1.0 - max(0.0, dot(normalize(-mvPosition.xyz), normalize(newPos))), 3.0);
    vEnergy = energyLevel;
    vDepth = clamp(-mvPosition.z / 120.0, 0.0, 1.0);

    float alpha = 1.0 - smoothstep(uRadius * 0.7, uRadius, distToCenter);
    float sparkle = 1.0 + (aRandom.x > 0.8 ? sin(uTime * 20.0 + aRandom.y * 150.0) * uHigh * 2.5 : 0.0);
    vAlpha = alpha * sparkle * (0.7 + uMid * 0.35) * layerMod;
}`;

const fragmentShader = `
varying vec3 vColor;
varying float vAlpha, vEnergy, vDepth, vRimLight;

void main() {
    vec2 xy = gl_PointCoord.xy - vec2(0.5);
    float r = length(xy);
    if(r > 0.5) discard;

    float core = smoothstep(0.16 - vEnergy * 0.04, 0.12 - vEnergy * 0.04, r);
    float glow = exp(-r * r * (20.0 - vEnergy * 10.0));
    float halo = exp(-r * r * 5.0) * 0.35 + exp(-r * r * 2.5) * 0.15;

    vec3 finalColor = mix(vColor, vec3(1.0, 0.95, 0.9), core * 0.7);
    finalColor += vec3(0.2, 0.3, 0.4) * vRimLight * 0.3;
    finalColor = mix(finalColor, vec3(0.02, 0.03, 0.05), vDepth * 0.4);

    float finalAlpha = clamp(vAlpha * (glow + halo + pow(1.0 - r * 2.0, 2.5) * 0.6), 0.0, 1.0);
    gl_FragColor = vec4(finalColor, finalAlpha);
}`;

// ═══════ POST-PROCESSING SHADERS ═══════

// GOD RAYS SHADER (Radial Light Scattering)
const GodRaysShader = {
  uniforms: {
    tDiffuse: { value: null },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) },
    uIntensity: { value: 0.35 },
    uDecay: { value: 0.94 },
    uBeatEnergy: { value: 0.0 }
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform vec2 uCenter;
        uniform float uIntensity, uDecay, uBeatEnergy;
        varying vec2 vUv;

        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            vec2 dir = vUv - uCenter;
            float dist = length(dir);
            dir = normalize(dir);

            vec3 rays = vec3(0.0);
            float decay = 1.0;

            for(int i = 0; i < 32; i++) {
                float t = float(i) / 32.0;
                vec2 samplePos = vUv - dir * t * 0.15 * (1.0 + uBeatEnergy);
                vec4 s = texture2D(tDiffuse, samplePos);
                float lum = dot(s.rgb, vec3(0.3, 0.59, 0.11));
                rays += s.rgb * decay * step(0.35, lum);
                decay *= uDecay;
            }
            rays /= 16.0;
            rays *= (1.0 - smoothstep(0.3, 0.9, dist));

            gl_FragColor = vec4(color.rgb + rays * uIntensity * (1.0 + uBeatEnergy * 0.8), color.a);
        }`
};

// LENS FLARE POST-PROCESS SHADER (Cinematic)
const LensFlareShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 1.0 },
    uBeatEnergy: { value: 0.0 },
    uTime: { value: 0.0 }
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uIntensity, uBeatEnergy, uTime;
        varying vec2 vUv;

        float sdHex(vec2 p) {
            p = abs(p);
            return max(p.x * 0.866 + p.y * 0.5, p.y) - 1.0;
        }

        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            vec2 center = vec2(0.5);
            vec2 toCenter = center - vUv;
            float dist = length(toCenter);
            vec2 dir = normalize(toCenter + 0.0001);
            
            vec3 flare = vec3(0.0);
            
            // Sample bright areas for flare source
            float brightness = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            float threshold = smoothstep(0.6, 0.9, brightness);
            
            // Anamorphic horizontal streak
            float streak = 0.0;
            for(float i = -8.0; i <= 8.0; i += 1.0) {
                vec2 streakUV = vUv + vec2(i * 0.012, 0.0);
                vec4 streakSample = texture2D(tDiffuse, streakUV);
                float streakBright = dot(streakSample.rgb, vec3(0.299, 0.587, 0.114));
                float falloff = 1.0 - abs(i) / 10.0;
                streak += smoothstep(0.7, 1.0, streakBright) * falloff * falloff;
            }
            flare += vec3(0.6, 0.7, 1.0) * streak * 0.08;
            
            // Subtle ghosts (reflections through lens elements)
            for(int i = 1; i <= 3; i++) {
                float scale = 1.0 - float(i) * 0.25;
                vec2 ghostUV = center + (center - vUv) * scale * 0.8;
                if(ghostUV.x > 0.0 && ghostUV.x < 1.0 && ghostUV.y > 0.0 && ghostUV.y < 1.0) {
                    vec4 ghostSample = texture2D(tDiffuse, ghostUV);
                    float ghostBright = dot(ghostSample.rgb, vec3(0.299, 0.587, 0.114));
                    float ghostAlpha = smoothstep(0.5, 0.8, ghostBright) * (0.25 / float(i));
                    vec3 ghostTint = vec3(0.7, 0.8, 1.0) * (1.0 - float(i) * 0.2);
                    flare += ghostSample.rgb * ghostTint * ghostAlpha;
                }
            }
            
            // Soft circular halo around bright center
            float halo = smoothstep(0.25, 0.15, abs(dist - 0.2)) * threshold * 0.25;
            flare += vec3(0.5, 0.6, 0.9) * halo;
            
            // Subtle vignette-edge glow
            float edgeGlow = smoothstep(0.5, 0.7, dist) * (1.0 - smoothstep(0.7, 0.85, dist));
            flare += vec3(0.3, 0.4, 0.6) * edgeGlow * brightness * 0.15;
            
            gl_FragColor = vec4(color.rgb + flare * uIntensity * (1.0 + uBeatEnergy * 0.3), color.a);
        }`
};

// ANAMORPHIC FLARE SHADER
const AnamorphicShader = {
  uniforms: {
    tDiffuse: { value: null },
    uStretch: { value: 0.1 },
    uThreshold: { value: 0.7 },
    uIntensity: { value: 0.4 }
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uStretch, uThreshold, uIntensity;
        varying vec2 vUv;
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            vec3 streak = vec3(0.0);
            for(float i = -15.0; i <= 15.0; i++) {
                vec4 s = texture2D(tDiffuse, vUv + vec2(i * uStretch * 0.01, 0.0));
                float bright = dot(s.rgb, vec3(0.299, 0.587, 0.114));
                if(bright > uThreshold) {
                    float w = 1.0 - abs(i) / 15.0;
                    streak += s.rgb * w * w;
                }
            }
            gl_FragColor = vec4(color.rgb + streak / 7.5 * vec3(0.6, 0.8, 1.0) * uIntensity, color.a);
        }`
};

// CHROMATIC ABERRATION SHADER
const ChromaticShader = {
  uniforms: {
    tDiffuse: { value: null },
    uIntensity: { value: 0.004 },
    uBeatEnergy: { value: 0.0 }
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uIntensity, uBeatEnergy;
        varying vec2 vUv;
        void main() {
            vec2 dir = vUv - vec2(0.5);
            float dist = length(dir);
            vec2 offset = dir * dist * uIntensity * (1.0 + uBeatEnergy * 1.5);
            gl_FragColor = vec4(
                texture2D(tDiffuse, vUv + offset * 1.2).r,
                texture2D(tDiffuse, vUv).g,
                texture2D(tDiffuse, vUv - offset * 1.2).b,
                texture2D(tDiffuse, vUv).a
            );
        }`
};

// FILM GRAIN SHADER
const GrainShader = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0.0 },
    uIntensity: { value: 0.0 }
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uTime, uIntensity;
        varying vec2 vUv;
        float rand(vec2 co) { return fract(sin(dot(co, vec2(12.9898,78.233))) * 43758.5453); }
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            float grain = (rand(vUv + fract(uTime)) * 2.0 - 1.0) * uIntensity;
            gl_FragColor = vec4(color.rgb + grain * (1.0 - dot(color.rgb, vec3(0.299, 0.587, 0.114)) * 0.5), color.a);
        }`
};

// CUSTOM DEPTH OF FIELD SHADER (Radial + Edge blur)
const CustomDOFShader = {
  uniforms: {
    tDiffuse: { value: null },
    uFocus: { value: 0.05 },
    uFocalLength: { value: 0.25 },
    uBokehStrength: { value: 0.5 },
    uResolution: { value: new THREE.Vector2() },
    uBeatEnergy: { value: 0.0 }
  },
  vertexShader: `
        varying vec2 vUv;
        void main() {
            vUv = uv;
            gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
    `,
  fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uFocus;
        uniform float uFocalLength;
        uniform float uBokehStrength;
        uniform vec2 uResolution;
        uniform float uBeatEnergy;
        varying vec2 vUv;
        
        void main() {
            vec2 center = vec2(0.5);
            float dist = length(vUv - center);
            
            // Focus ring - sharp in a ring around center, blurry inside and outside
            float focusRing = abs(dist - uFocus);
            float blur = smoothstep(0.0, uFocalLength, focusRing) * uBokehStrength;
            
            vec3 color = vec3(0.0);
            float total = 0.0;
            vec2 texel = 1.0 / uResolution;
            
            if(blur < 0.01) {
                color = texture2D(tDiffuse, vUv).rgb;
                total = 1.0;
            } else {
                // Golden angle spiral sampling
                const float GOLDEN_ANGLE = 2.39996323;
                const int SAMPLES = 24;
                float radius = blur * 20.0 * (1.0 + uBeatEnergy * 0.1);
                
                for(int i = 0; i < SAMPLES; i++) {
                    float angle = float(i) * GOLDEN_ANGLE;
                    float r = sqrt(float(i) / float(SAMPLES)) * radius;
                    vec2 offset = vec2(cos(angle), sin(angle)) * r * texel;
                    vec3 s = texture2D(tDiffuse, vUv + offset).rgb;
                    
                    // Subtle highlight boost
                    float lum = dot(s, vec3(0.299, 0.587, 0.114));
                    s *= 1.0 + smoothstep(0.7, 1.0, lum) * blur * 0.3;
                    
                    color += s;
                    total += 1.0;
                }
            }
            
            gl_FragColor = vec4(color / total, texture2D(tDiffuse, vUv).a);
        }
    `
};

// VIGNETTE + GLOW SHADER
const VignetteShader = {
  uniforms: {
    tDiffuse: { value: null },
    uBeatEnergy: { value: 0.0 }
  },
  vertexShader: `varying vec2 vUv; void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
  fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uBeatEnergy;
        varying vec2 vUv;
        void main() {
            vec4 color = texture2D(tDiffuse, vUv);
            vec2 uv = vUv * (1.0 - vUv.yx);
            float vig = pow(uv.x * uv.y * 15.0, 0.38 * (1.0 - uBeatEnergy * 0.15));
            float lum = dot(color.rgb, vec3(0.299, 0.587, 0.114));
            float glow = smoothstep(0.5, 0.9, lum) * 0.1 * (1.0 + uBeatEnergy * 0.5);
            gl_FragColor = vec4(color.rgb * vig * (1.0 + glow), color.a);
        }`
};

// ═══════ GEOMETRY ═══════
const geometry = new THREE.BufferGeometry();
const pos = [],
  rnd = [],
  phase = [],
  layer = [];
const vec = new THREE.Vector3();

for (let i = 0; i < CONFIG.maxParticles; i++) {
  vec.setFromSphericalCoords(
    CONFIG.fieldRadius * Math.pow(Math.random(), 0.33),
    Math.acos(2 * Math.random() - 1),
    Math.random() * Math.PI * 2
  );
  pos.push(vec.x, vec.y, vec.z);
  rnd.push(Math.random(), Math.random(), Math.random());
  phase.push(Math.random() * Math.PI * 2);
  layer.push(0);
}

// Secondary particles now use separate instanced system below

geometry.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
geometry.setAttribute("aRandom", new THREE.Float32BufferAttribute(rnd, 3));
geometry.setAttribute("aPhase", new THREE.Float32BufferAttribute(phase, 1));
geometry.setAttribute("aLayer", new THREE.Float32BufferAttribute(layer, 1));
geometry.setDrawRange(
  0,
  Math.floor((CONFIG.maxParticles + CONFIG.secondaryParticles) * STATE.density)
);

const FIELD_TYPES = {
  "Photon (EM)": {
    c1: "#00f2ff",
    c2: "#0051ff",
    c3: "#ffffff",
    s: 1.0,
    curl: 1.0,
    sz: 3.0,
    sc1: "#66d9ff",
    sc2: "#99eeff"
  },
  "Gluon (Strong)": {
    c1: "#ff0055",
    c2: "#7000ff",
    c3: "#ff8800",
    s: 2.5,
    curl: 2.4,
    sz: 3.4,
    sc1: "#cc66ff",
    sc2: "#ff6699"
  },
  "Higgs (Mass)": {
    c1: "#ffae00",
    c2: "#ff4800",
    c3: "#ffff00",
    s: 0.6,
    curl: 0.3,
    sz: 4.0,
    sc1: "#ffcc66",
    sc2: "#ffdd99"
  },
  Gravity: {
    c1: "#ffffff",
    c2: "#4466ff",
    c3: "#8844ff",
    s: 0.75,
    curl: 0.18,
    sz: 2.8,
    sc1: "#aabbff",
    sc2: "#ccaaff"
  },
  "Dark Energy": {
    c1: "#1a0033",
    c2: "#6600ff",
    c3: "#ff00ff",
    s: 1.9,
    curl: 1.6,
    sz: 3.1,
    sc1: "#9933ff",
    sc2: "#cc66ff"
  },
  Neutrino: {
    c1: "#00ff88",
    c2: "#00ffcc",
    c3: "#88ffff",
    s: 3.0,
    curl: 3.0,
    sz: 2.6,
    sc1: "#66ffbb",
    sc2: "#99ffdd"
  },
  // === ENHANCEMENT: Waveform Terrain Field ===
  "Waveform Terrain": {
    c1: "#ff3366",
    c2: "#33ff99",
    c3: "#6633ff",
    s: 0.4,
    curl: 0.15,
    sz: 2.4,
    sc1: "#ff6699",
    sc2: "#66ffcc",
    terrain: true
  }
};

// === ENHANCEMENT: Adaptive Quality System ===
const QUALITY_SYSTEM = {
  frameCount: 0,
  frameTimes: [],
  lastAdjustTime: 0,
  currentFPS: 60,

  update(deltaTime) {
    this.frameCount++;
    this.frameTimes.push(deltaTime);
    if (this.frameTimes.length > 30) this.frameTimes.shift();

    if (this.frameCount % 30 === 0) {
      const avgDelta = this.frameTimes.reduce((a, b) => a + b, 0) / this.frameTimes.length;
      this.currentFPS = 1000 / avgDelta;

      if (STATE.adaptiveQualityEnabled && performance.now() - this.lastAdjustTime > 2000) {
        if (this.currentFPS < STATE.targetFPS - 10 && STATE.qualityLevel > 0.3) {
          STATE.qualityLevel = Math.max(0.3, STATE.qualityLevel - 0.1);
          this.applyQuality();
          this.lastAdjustTime = performance.now();
        } else if (this.currentFPS > STATE.targetFPS + 5 && STATE.qualityLevel < 1.0) {
          STATE.qualityLevel = Math.min(1.0, STATE.qualityLevel + 0.05);
          this.applyQuality();
          this.lastAdjustTime = performance.now();
        }
      }
    }
  },

  applyQuality() {
    const q = STATE.qualityLevel;
    geometry.setDrawRange(0, Math.floor(CONFIG.maxParticles * STATE.density * q));
    renderer.setPixelRatio(Math.max(1, STATE.pixelRatio * q));
  }
};

// === ENHANCEMENT: Audio-Reactive Camera System ===
const AUDIO_CAMERA = {
  targetOffset: new THREE.Vector3(),
  currentOffset: new THREE.Vector3(),
  targetFOV: 55,
  baseFOV: 55,
  breathPhase: 0,

  update(deltaTime) {
    if (!STATE.audioCameraEnabled || !AUDIO.active) return;

    const bass = AUDIO.gatedBands.bass;
    const mid = AUDIO.gatedBands.mid;
    const high = AUDIO.gatedBands.high;
    const intensity = STATE.audioCameraIntensity;
    const smooth = STATE.audioCameraSmoothing;

    // Bass-driven zoom pulse
    this.targetFOV = this.baseFOV + AUDIO.beatEnergy * 2 * intensity;
    camera.fov += (this.targetFOV - camera.fov) * smooth;
    camera.updateProjectionMatrix();

    // Subtle sway based on mid frequencies
    this.breathPhase += deltaTime * 0.001 * (1 + mid * 2);
    this.targetOffset.x = Math.sin(this.breathPhase * 0.7) * mid * 3 * intensity;
    this.targetOffset.y = Math.cos(this.breathPhase * 0.5) * high * 2 * intensity;
    this.targetOffset.z = Math.sin(this.breathPhase * 0.3) * bass * 4 * intensity;

    // Smooth interpolation
    this.currentOffset.lerp(this.targetOffset, smooth);

    // Apply onset punch
    if (AUDIO.onsetDetected) {
      this.currentOffset.z -= AUDIO.onsetEnergy * 2 * intensity;
    }
  }
};

const def = FIELD_TYPES[STATE.field];
const material = new THREE.ShaderMaterial({
  vertexShader,
  fragmentShader,
  uniforms: {
    uTime: { value: 0 },
    uPixelRatio: { value: STATE.pixelRatio },
    uSizeBase: { value: def.sz },
    uNoiseScale: { value: def.s },
    uCurlStrength: { value: def.curl },
    uRadius: { value: CONFIG.fieldRadius },
    uColor1: { value: new THREE.Color(def.c1) },
    uColor2: { value: new THREE.Color(def.c2) },
    uColor3: { value: new THREE.Color(def.c3) },
    uSubBass: { value: 0 },
    uBass: { value: 0 },
    uLowMid: { value: 0 },
    uMid: { value: 0 },
    uHighMid: { value: 0 },
    uHigh: { value: 0 },
    uUltraHigh: { value: 0 },
    uBeatEnergy: { value: 0 },
    uSpectralCentroid: { value: 0 },
    uSpectralFlux: { value: 0 },
    uOnsetEnergy: { value: 0 },
    uTerrainMode: { value: 0 },
    uTerrainHeight: { value: 15.0 },
    uVortexStrength: { value: STATE.vortexStrength },
    uPulseIntensity: { value: STATE.pulseIntensity },
    uZoomFactor: { value: 1.0 },
    uAudioActivity: { value: 0 },
    uMousePos: { value: new THREE.Vector3(999, 999, 999) },
    uMouseVelocity: { value: new THREE.Vector2(0, 0) }
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const points = new THREE.Points(geometry, material);
scene.add(points);

// ═══════ INSTANCED SECONDARY PARTICLES ═══════
const secondaryVertexShader = `
uniform float uTime, uPixelRatio;
uniform float uSubBass, uBass, uLowMid, uMid, uHighMid, uHigh, uUltraHigh;
uniform float uBeatEnergy, uSpectralCentroid, uSpectralFlux, uOnsetEnergy;
uniform vec3 uColor1, uColor2;
uniform float uRadius, uVortexStrength, uAudioActivity;

attribute vec3 instancePosition;
attribute vec3 instanceRandom;
attribute float instancePhase;

varying vec3 vColor;
varying float vAlpha;
varying float vEnergy;
varying float vDepth;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x*34.0)+1.0)*x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod289(i);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 0.142857142857;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ * ns.x + ns.yyyy;
    vec4 y = y_ * ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0) * 2.0 + 1.0;
    vec4 s1 = floor(b1) * 2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    m = m * m;
    return 42.0 * dot(m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

void main() {
    // Secondary particles run at a slower timescale — they are the atmosphere, not the core
    float t = uTime * 0.45;

    // Multi-scale noise flow — low freqs drive large drift, high freqs add fine turbulence
    vec3 noisePos = instancePosition * 0.035 + instanceRandom;
    vec3 drift    = vec3(
        snoise(noisePos + t * 0.06),
        snoise(noisePos * 0.9 - t * 0.05),
        snoise(noisePos * 1.1 + t * 0.04)
    ) * (5.0 + uSubBass * 10.0 + uLowMid * 6.0);

    vec3 turbulence = vec3(
        snoise(noisePos * 2.5 + t * 0.18),
        snoise(noisePos * 2.5 - t * 0.14),
        snoise(noisePos * 2.5 + t * 0.12)
    ) * (uHigh * 5.0 + uSpectralFlux * 8.0);

    vec3 offset = drift + turbulence;

    // Orbital drift — vortex-aware, modulated by bass
    float orbitSpeed = 0.12 + instanceRandom.x * 0.15 + uBass * 0.08;
    float angle = uTime * orbitSpeed + instancePhase;
    float orbitRadius = length(instancePosition.xz) * (1.0 + uSubBass * 0.25);
    // Vortex coupling — secondary shell rotates with the main field vortex
    float vortexInfluence = uVortexStrength * uBass * 0.4;
    float vAngle = angle + vortexInfluence;
    vec3 orbit = vec3(
        cos(vAngle) * orbitRadius - instancePosition.x,
        sin(uTime * 0.5 + instancePhase) * (uMid * 4.0 + uLowMid * 2.0),
        sin(vAngle) * orbitRadius - instancePosition.z
    ) * 0.07;

    vec3 newPos = instancePosition + offset + orbit;

    // Onset scatter — transients push particles outward in a quick burst
    float dist = length(newPos);
    vec3 dir = normalize(newPos + 0.001);
    newPos += dir * uOnsetEnergy * 14.0 * exp(-dist * 0.025);

    // Beat breathing — sub-bass driven expansion
    float breathe = sin(uTime * 1.2 + instancePhase) * uSubBass * 5.0;
    newPos += dir * breathe * exp(-dist * 0.035);

    vec4 mvPosition = modelViewMatrix * vec4(newPos, 1.0);
    gl_Position = projectionMatrix * mvPosition;

    // Size: driven by different bands than the main system
    // Sparkle on ultraHigh, swell on subBass, punch on beatEnergy
    float sparkle = 1.0 + (instanceRandom.x > 0.85 ? sin(uTime * 15.0 + instanceRandom.y * 200.0) * uUltraHigh * 3.0 : 0.0);
    float swell = 1.0 + uSubBass * 0.6 + uLowMid * 0.3;
    float idleScale = mix(2.0, 1.0, uAudioActivity);
    float size = 0.225 * idleScale * (1.1 + uBeatEnergy * 0.25) * swell * sparkle;
    gl_PointSize = clamp(size * uPixelRatio * (55.0 / -mvPosition.z), 0.25, 4.0);

    // Colour: spectral centroid shifts hue, highMid brightens toward white
    float centroidMix = clamp(uSpectralCentroid * 2.2 + uHighMid * 0.4, 0.0, 1.0);
    vColor = mix(uColor1, uColor2, centroidMix);
    // SubBass warmth — hint of deep colour saturation on heavy lows
    vColor = mix(vColor, vColor * 1.3, uSubBass * 0.4);
    // Beat flash — brief white-hot core
    vColor = mix(vColor, vec3(1.0), uBeatEnergy * 0.25);

    // Alpha: outer shell fades at edge, mid-frequency presence sustains visibility
    float edgeFade = 1.0 - smoothstep(uRadius * 0.6, uRadius * 1.15, dist);
    vAlpha = edgeFade * (0.45 + uMid * 0.35 + uLowMid * 0.2) * sparkle;

    vEnergy = uBeatEnergy * 0.4 + uHighMid * 0.3 + uOnsetEnergy * 0.3;
    vDepth = clamp(-mvPosition.z / 160.0, 0.0, 1.0);
}
`;

const secondaryFragmentShader = `
varying vec3 vColor;
varying float vAlpha;
varying float vEnergy;
varying float vDepth;

void main() {
    vec2 xy = gl_PointCoord.xy - vec2(0.5);
    float r = length(xy);
    if (r > 0.5) discard;

    // Compact glow keeps bright stars crisp instead of making them look larger.
    float glow     = exp(-r * r * 14.0);
    float softGlow = exp(-r * r * 7.0) * 0.3;
    float core     = smoothstep(0.18 - vEnergy * 0.06, 0.10, r);

    vec3 finalColor = mix(vColor, vec3(1.0, 0.97, 0.92), core * 0.55);
    // Depth haze — far particles shift slightly cooler/dimmer
    finalColor = mix(finalColor, vec3(0.02, 0.03, 0.06), vDepth * 0.35);

    float finalAlpha = clamp(vAlpha * (glow * 0.65 + softGlow + core * 0.35), 0.0, 1.0);
    gl_FragColor = vec4(finalColor, finalAlpha);
}
`;

// Create instanced geometry for secondary particles
const secondaryGeometry = new THREE.InstancedBufferGeometry();

// Base geometry (single point)
const basePositions = new Float32Array([0, 0, 0]);
secondaryGeometry.setAttribute("position", new THREE.BufferAttribute(basePositions, 3));

// Instance attributes
const instancePositions = new Float32Array(CONFIG.secondaryParticles * 3);
const instanceRandoms = new Float32Array(CONFIG.secondaryParticles * 3);
const instancePhases = new Float32Array(CONFIG.secondaryParticles);

for (let i = 0; i < CONFIG.secondaryParticles; i++) {
  // Distribute in outer shell
  const r = CONFIG.fieldRadius * (0.65 + Math.random() * 0.45);
  const theta = Math.acos(2 * Math.random() - 1);
  const phi = Math.random() * Math.PI * 2;

  instancePositions[i * 3] = r * Math.sin(theta) * Math.cos(phi);
  instancePositions[i * 3 + 1] = r * Math.sin(theta) * Math.sin(phi);
  instancePositions[i * 3 + 2] = r * Math.cos(theta);

  instanceRandoms[i * 3] = Math.random();
  instanceRandoms[i * 3 + 1] = Math.random();
  instanceRandoms[i * 3 + 2] = Math.random();

  instancePhases[i] = Math.random() * Math.PI * 2;
}

secondaryGeometry.setAttribute(
  "instancePosition",
  new THREE.InstancedBufferAttribute(instancePositions, 3)
);
secondaryGeometry.setAttribute(
  "instanceRandom",
  new THREE.InstancedBufferAttribute(instanceRandoms, 3)
);
secondaryGeometry.setAttribute(
  "instancePhase",
  new THREE.InstancedBufferAttribute(instancePhases, 1)
);

const secondaryMaterial = new THREE.ShaderMaterial({
  vertexShader: secondaryVertexShader,
  fragmentShader: secondaryFragmentShader,
  uniforms: {
    uTime: { value: 0 },
    uPixelRatio: { value: STATE.pixelRatio },
    uSubBass: { value: 0 },
    uBass: { value: 0 },
    uLowMid: { value: 0 },
    uMid: { value: 0 },
    uHighMid: { value: 0 },
    uHigh: { value: 0 },
    uUltraHigh: { value: 0 },
    uBeatEnergy: { value: 0 },
    uSpectralCentroid: { value: 0 },
    uSpectralFlux: { value: 0 },
    uOnsetEnergy: { value: 0 },
    uVortexStrength: { value: STATE.vortexStrength },
    uAudioActivity: { value: 0 },
    uColor1: { value: new THREE.Color(def.sc1) },
    uColor2: { value: new THREE.Color(def.sc2) },
    uRadius: { value: CONFIG.fieldRadius }
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const secondaryPoints = new THREE.Points(secondaryGeometry, secondaryMaterial);
scene.add(secondaryPoints);

// Add to STATE for GUI control
STATE.secondaryEnabled = true;
STATE.secondaryOpacity = 1.0;

// ═══════ PARTICLE TRAIL SYSTEM ═══════
class TrailSystem {
  constructor(count, length) {
    this.trails = [];
    this.meshes = [];

    for (let i = 0; i < count; i++) {
      const trail = {
        positions: Array(length)
          .fill()
          .map(
            () =>
              new THREE.Vector3(
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 80,
                (Math.random() - 0.5) * 80
              )
          ),
        phase: Math.random() * Math.PI * 2,
        speed: 0.3 + Math.random() * 0.7,
        color: new THREE.Color().setHSL(Math.random(), 0.7, 0.6)
      };
      this.trails.push(trail);

      const geom = new THREE.BufferGeometry();
      const positions = new Float32Array(length * 3);
      const alphas = new Float32Array(length);
      for (let j = 0; j < length; j++) alphas[j] = 1.0 - j / length;

      geom.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      geom.setAttribute("alpha", new THREE.BufferAttribute(alphas, 1));

      const mat = new THREE.ShaderMaterial({
        vertexShader: `attribute float alpha; varying float vAlpha; void main() { vAlpha = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }`,
        fragmentShader: `uniform vec3 uColor; uniform float uOpacity, uBeat, uImpact, uLongness; varying float vAlpha; void main() {
                            float longHit = uLongness * uImpact;
                            vec3 c = min(uColor * (0.76 + uBeat * 0.28 + longHit * 1.15), vec3(1.35));
                            float alpha = vAlpha * uOpacity * (0.28 + uBeat * 0.22 + longHit * 0.72);
                            gl_FragColor = vec4(c, clamp(alpha, 0.0, 0.82));
                        }`,
        uniforms: {
          uColor: { value: trail.color },
          uOpacity: { value: 0.4 },
          uBeat: { value: 0 },
          uImpact: { value: 0 },
          uLongness: { value: 0 }
        },
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending
      });

      const line = new THREE.Line(geom, mat);
      this.meshes.push(line);
      scene.add(line);
    }
  }

  update(time, audio, fieldColor) {
    for (let i = 0; i < this.trails.length; i++) {
      const trail = this.trails[i],
        mesh = this.meshes[i];
      mesh.visible = STATE.particleTrailsEnabled;
      if (!mesh.visible) continue;

      const angle = time * 0.5 * trail.speed + trail.phase;
      const radius = 30 + audio.bass * 20;
      const newPos = new THREE.Vector3(
        Math.cos(angle) * radius +
          Math.sin(time * trail.speed + trail.phase) * (10 + audio.bass * 15),
        Math.sin(time * 0.3 + trail.phase) * 20 +
          Math.cos(time * trail.speed * 0.7 + trail.phase) * (8 + audio.mid * 12),
        Math.sin(angle) * radius +
          Math.sin(time * trail.speed * 0.5 + trail.phase * 2) * (10 + audio.high * 10)
      );

      const tail = trail.positions[trail.positions.length - 1];
      const span = newPos.distanceTo(tail);
      const longness = THREE.MathUtils.smoothstep(span, 18, 48);
      const impact = Math.max(audio.beat, audio.onset, audio.highMid * 0.72, audio.high * 0.58);
      if (longness > 0) newPos.multiplyScalar(1 + longness * impact * 0.12);

      for (let j = trail.positions.length - 1; j > 0; j--)
        trail.positions[j].copy(trail.positions[j - 1]);
      trail.positions[0].copy(newPos);

      const posAttr = mesh.geometry.getAttribute("position");
      for (let j = 0; j < trail.positions.length; j++) {
        posAttr.setXYZ(j, trail.positions[j].x, trail.positions[j].y, trail.positions[j].z);
      }
      posAttr.needsUpdate = true;

      mesh.material.uniforms.uBeat.value = audio.beat;
      mesh.material.uniforms.uImpact.value = impact;
      mesh.material.uniforms.uLongness.value = longness;
      mesh.material.uniforms.uOpacity.value = STATE.particleTrailOpacity;
      if (fieldColor) trail.color.lerp(fieldColor, 0.01);
    }
  }
}

const trailSystem = new TrailSystem(50, 12);

// ═══════ PARTICLE CONNECTIONS (Force Network) ═══════
const connectionCount = 500; // Number of particles to check for connections
const maxConnections = 800; // Maximum line segments
const connectionGeometry = new THREE.BufferGeometry();
const connectionPositions = new Float32Array(maxConnections * 6); // 2 points per line, 3 coords each
const connectionAlphas = new Float32Array(maxConnections * 2); // Alpha per vertex
connectionGeometry.setAttribute("position", new THREE.BufferAttribute(connectionPositions, 3));
connectionGeometry.setAttribute("alpha", new THREE.BufferAttribute(connectionAlphas, 1));
connectionGeometry.setDrawRange(0, 0);

const connectionMaterial = new THREE.ShaderMaterial({
  vertexShader: `
        attribute float alpha;
        varying float vAlpha;
        varying float vDist;
        void main() {
            vAlpha = alpha;
            vec4 mvPos = modelViewMatrix * vec4(position, 1.0);
            vDist = length(position) / 90.0; // normalised distance from centre
            gl_Position = projectionMatrix * mvPos;
        }
    `,
  fragmentShader: `
        uniform vec3 uColor;
        uniform vec3 uColor2;
        uniform float uOpacity;
        uniform float uBeatEnergy;
        uniform float uOnsetEnergy;
        uniform float uBass;
        uniform float uHighMid;
        uniform float uSpectralCentroid;
        varying float vAlpha;
        varying float vDist;
        void main() {
            // Blend hue with spectral centroid (brighter/higher = more c2)
            vec3 color = mix(uColor, uColor2, clamp(uSpectralCentroid * 2.0, 0.0, 1.0));
            // Core lines are brighter
            float coreBrightness = 1.0 + (1.0 - vDist) * 0.6;
            color *= coreBrightness;
            // Beat pulse flash
            float bassPulse = smoothstep(0.06, 0.65, uBass);
            float transientFlash = max(uBeatEnergy, uOnsetEnergy);
            float lineEnergy = bassPulse * 0.35 + uHighMid * 0.2 + uBeatEnergy * 0.65 + uOnsetEnergy * 0.55;
            color *= 0.72 + lineEnergy;
            color = min(color, vec3(1.35));
            // Lines react through controlled opacity without blowing out Bloom.
            float lineAlpha = vAlpha * uOpacity * (0.18 + uHighMid * 0.3 + bassPulse * 0.35 + transientFlash * 0.55);
            gl_FragColor = vec4(color, clamp(lineAlpha, 0.0, 0.72));
        }
    `,
  uniforms: {
    uColor: { value: new THREE.Color(def.c2) },
    uColor2: { value: new THREE.Color(def.c1) },
    uOpacity: { value: 1.0 },
    uBeatEnergy: { value: 0 },
    uOnsetEnergy: { value: 0 },
    uBass: { value: 0 },
    uHighMid: { value: 0 },
    uSpectralCentroid: { value: 0 }
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const connectionMesh = new THREE.LineSegments(connectionGeometry, connectionMaterial);
scene.add(connectionMesh);

// Particle indices to track for connections — refreshed periodically
const trackedParticles = [];
let connectionRefreshCounter = 0;
const CONNECTION_REFRESH_INTERVAL = 120; // frames

function refreshTrackedParticles() {
  trackedParticles.length = 0;
  for (let i = 0; i < connectionCount; i++) {
    trackedParticles.push(Math.floor(Math.random() * CONFIG.maxParticles));
  }
}
refreshTrackedParticles();

function updateConnections(threshold, bassBoost, highMid, mid) {
  // Refresh particle selection every N frames — network evolves over time
  connectionRefreshCounter++;
  if (connectionRefreshCounter >= CONNECTION_REFRESH_INTERVAL) {
    refreshTrackedParticles();
    connectionRefreshCounter = 0;
  }

  const posAttr = geometry.getAttribute("position");
  const positions = [];

  // Get current positions of tracked particles
  for (let i = 0; i < trackedParticles.length; i++) {
    const idx = trackedParticles[i];
    positions.push(new THREE.Vector3(posAttr.getX(idx), posAttr.getY(idx), posAttr.getZ(idx)));
  }

  // Threshold breathes with bass, tightens on high energy
  const effectiveThreshold = threshold * (1.0 + bassBoost * 1.4) * (1.0 - highMid * 0.08);
  const thresholdSq = effectiveThreshold * effectiveThreshold;

  // Dynamic connection cap — expands with mid+highMid energy
  const dynamicMax = Math.floor(
    maxConnections * Math.min(1.0, 0.22 + bassBoost * 0.55 + mid * 0.45 + highMid * 0.65)
  );

  let connIdx = 0;
  for (let i = 0; i < positions.length && connIdx < dynamicMax; i++) {
    for (let j = i + 1; j < positions.length && connIdx < dynamicMax; j++) {
      const distSq = positions[i].distanceToSquared(positions[j]);
      if (distSq < thresholdSq && distSq > 0.1) {
        const dist = Math.sqrt(distSq);
        // Alpha: fade with distance, boost near field centre
        const centreProximity =
          1.0 - Math.min(((positions[i].length() + positions[j].length()) * 0.5) / 90.0, 1.0);
        const alpha = (1.0 - dist / effectiveThreshold) * (0.6 + centreProximity * 0.4);

        connectionPositions[connIdx * 6 + 0] = positions[i].x;
        connectionPositions[connIdx * 6 + 1] = positions[i].y;
        connectionPositions[connIdx * 6 + 2] = positions[i].z;
        connectionPositions[connIdx * 6 + 3] = positions[j].x;
        connectionPositions[connIdx * 6 + 4] = positions[j].y;
        connectionPositions[connIdx * 6 + 5] = positions[j].z;

        connectionAlphas[connIdx * 2 + 0] = alpha;
        connectionAlphas[connIdx * 2 + 1] = alpha;

        connIdx++;
      }
    }
  }

  connectionGeometry.attributes.position.needsUpdate = true;
  connectionGeometry.attributes.alpha.needsUpdate = true;
  connectionGeometry.setDrawRange(0, connIdx * 2);
}

// ═══════ NETWORK CRAWLERS ═══════
const CRAWLER_COUNT = 24; // concurrent crawlers
const CRAWLER_TAIL = 10; // trail positions per crawler
const crawlerMaxSegs = CRAWLER_COUNT * (CRAWLER_TAIL - 1);

const crawlerGeo = new THREE.BufferGeometry();
const crawlerPos = new Float32Array(crawlerMaxSegs * 6);
const crawlerAlp = new Float32Array(crawlerMaxSegs * 2);
crawlerGeo.setAttribute("position", new THREE.BufferAttribute(crawlerPos, 3));
crawlerGeo.setAttribute("alpha", new THREE.BufferAttribute(crawlerAlp, 1));
crawlerGeo.setDrawRange(0, 0);

const crawlerMaterial = new THREE.ShaderMaterial({
  vertexShader: `
                attribute float alpha;
                varying float vAlpha;
                void main() {
                    vAlpha = alpha;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }
            `,
  fragmentShader: `
                uniform vec3 uColor;
                uniform float uBeatEnergy;
                varying float vAlpha;
                void main() {
                    vec3 c = min(uColor * (0.82 + uBeatEnergy * 0.72), vec3(1.25));
                    gl_FragColor = vec4(c, min(vAlpha, 0.72));
                }
            `,
  uniforms: {
    uColor: { value: new THREE.Color(def.c1) },
    uBeatEnergy: { value: 0 }
  },
  transparent: true,
  depthWrite: false,
  blending: THREE.AdditiveBlending
});

const crawlerMesh = new THREE.LineSegments(crawlerGeo, crawlerMaterial);
scene.add(crawlerMesh);

// Initialise crawler agents
const crawlers = [];
const CRAWLER_MIN_STEP = 1.8; // min world-space distance before adding a tail point
for (let i = 0; i < CRAWLER_COUNT; i++) {
  crawlers.push({
    fromIdx: Math.floor(Math.random() * connectionCount),
    toIdx: Math.floor(Math.random() * connectionCount),
    t: Math.random(),
    speed: 0.0015 + Math.random() * 0.002,
    tail: [],
    lastTailPos: null, // last world position a tail point was recorded
    hue: Math.random()
  });
}

function updateCrawlers(dt, highMid, beatEnergy, spectralCentroid) {
  const posAttr = geometry.getAttribute("position");

  // Helper: world position of a tracked particle
  function particlePos(idx) {
    const pi = trackedParticles[idx % trackedParticles.length];
    return new THREE.Vector3(posAttr.getX(pi), posAttr.getY(pi), posAttr.getZ(pi));
  }

  // Helper: find nearest neighbour within threshold
  function nearestNeighbour(fromIdx, excludeIdx) {
    const origin = particlePos(fromIdx);
    const threshold = STATE.connectionThreshold * (1.2 + highMid * 0.4);
    const threshSq = threshold * threshold;
    let bestDist = Infinity,
      bestIdx = -1;
    const check = Math.min(trackedParticles.length, 80); // sample subset for perf
    const start = Math.floor(Math.random() * (trackedParticles.length - check));
    for (let k = start; k < start + check; k++) {
      const ki = k % trackedParticles.length;
      if (ki === fromIdx || ki === excludeIdx) continue;
      const d = origin.distanceToSquared(particlePos(ki));
      if (d < threshSq && d < bestDist) {
        bestDist = d;
        bestIdx = ki;
      }
    }
    // fallback: pick random if no neighbour in range
    return bestIdx === -1 ? Math.floor(Math.random() * trackedParticles.length) : bestIdx;
  }

  let segIdx = 0;

  for (let i = 0; i < crawlers.length; i++) {
    const c = crawlers[i];

    // Speed reacts to highMid (attack energy) and beat
    const spd = c.speed * (1.0 + highMid * 0.8 + beatEnergy * 0.5);
    c.t += spd;

    // Reached target — advance to next node
    if (c.t >= 1.0) {
      c.t -= 1.0;
      c.fromIdx = c.toIdx;
      c.toIdx = nearestNeighbour(c.fromIdx, c.fromIdx);
      // Occasionally teleport to keep crawlers spread across the field
      if (Math.random() < 0.04) {
        c.fromIdx = Math.floor(Math.random() * trackedParticles.length);
        c.toIdx = nearestNeighbour(c.fromIdx, c.fromIdx);
        c.tail = [];
        c.lastTailPos = null;
      }
    }

    // Current head position
    const from = particlePos(c.fromIdx);
    const to = particlePos(c.toIdx);
    const head = new THREE.Vector3().lerpVectors(from, to, c.t);

    // Contain within field sphere — clamp head to max radius
    const headDist = head.length();
    if (headDist > CONFIG.fieldRadius) head.multiplyScalar(CONFIG.fieldRadius / headDist);

    // Only record a tail point when head has moved far enough in world space
    const distMoved = c.lastTailPos ? head.distanceTo(c.lastTailPos) : Infinity;
    if (distMoved >= CRAWLER_MIN_STEP) {
      c.tail.push(head.clone());
      if (c.tail.length > CRAWLER_TAIL) c.tail.shift();
      c.lastTailPos = head.clone();
    }

    // Write tail segments
    const tailLen = c.tail.length;
    for (let s = 0; s < tailLen - 1 && segIdx < crawlerMaxSegs; s++) {
      const p0 = c.tail[s];
      const p1 = c.tail[s + 1];
      // Alpha: head is brightest, tail fades
      const baseAlpha = (s + 1) / (tailLen - 1);
      const alpha = baseAlpha * (0.25 + spectralCentroid * 0.3 + beatEnergy * 0.4);

      crawlerPos[segIdx * 6 + 0] = p0.x;
      crawlerPos[segIdx * 6 + 1] = p0.y;
      crawlerPos[segIdx * 6 + 2] = p0.z;
      crawlerPos[segIdx * 6 + 3] = p1.x;
      crawlerPos[segIdx * 6 + 4] = p1.y;
      crawlerPos[segIdx * 6 + 5] = p1.z;
      crawlerAlp[segIdx * 2 + 0] = alpha;
      crawlerAlp[segIdx * 2 + 1] = alpha;
      segIdx++;
    }
  }

  crawlerGeo.attributes.position.needsUpdate = true;
  crawlerGeo.attributes.alpha.needsUpdate = true;
  crawlerGeo.setDrawRange(0, segIdx * 2);
}

STATE.crawlersEnabled = true;

// ═══════ NEBULA BACKGROUND ═══════
const nebulaVertexShader = `
varying vec3 vWorldPosition;
varying vec2 vUv;
void main() {
    vUv = uv;
    vec4 worldPos = modelMatrix * vec4(position, 1.0);
    vWorldPosition = worldPos.xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

const nebulaFragmentShader = `
uniform float uTime;
uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;
uniform float uBass;
uniform float uMid;
uniform float uHigh;
uniform float uBeatEnergy;
uniform float uIntensity;
varying vec3 vWorldPosition;
varying vec2 vUv;

// Simplex 3D noise
vec4 permute(vec4 x) { return mod(((x*34.0)+1.0)*x, 289.0); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
    const vec2 C = vec2(1.0/6.0, 1.0/3.0);
    const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
    vec3 i = floor(v + dot(v, C.yyy));
    vec3 x0 = v - i + dot(i, C.xxx);
    vec3 g = step(x0.yzx, x0.xyz);
    vec3 l = 1.0 - g;
    vec3 i1 = min(g.xyz, l.zxy);
    vec3 i2 = max(g.xyz, l.zxy);
    vec3 x1 = x0 - i1 + C.xxx;
    vec3 x2 = x0 - i2 + C.yyy;
    vec3 x3 = x0 - D.yyy;
    i = mod(i, 289.0);
    vec4 p = permute(permute(permute(i.z + vec4(0.0, i1.z, i2.z, 1.0)) + i.y + vec4(0.0, i1.y, i2.y, 1.0)) + i.x + vec4(0.0, i1.x, i2.x, 1.0));
    float n_ = 1.0/7.0;
    vec3 ns = n_ * D.wyz - D.xzx;
    vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
    vec4 x_ = floor(j * ns.z);
    vec4 y_ = floor(j - 7.0 * x_);
    vec4 x = x_ *ns.x + ns.yyyy;
    vec4 y = y_ *ns.x + ns.yyyy;
    vec4 h = 1.0 - abs(x) - abs(y);
    vec4 b0 = vec4(x.xy, y.xy);
    vec4 b1 = vec4(x.zw, y.zw);
    vec4 s0 = floor(b0)*2.0 + 1.0;
    vec4 s1 = floor(b1)*2.0 + 1.0;
    vec4 sh = -step(h, vec4(0.0));
    vec4 a0 = b0.xzyw + s0.xzyw*sh.xxyy;
    vec4 a1 = b1.xzyw + s1.xzyw*sh.zzww;
    vec3 p0 = vec3(a0.xy, h.x);
    vec3 p1 = vec3(a0.zw, h.y);
    vec3 p2 = vec3(a1.xy, h.z);
    vec3 p3 = vec3(a1.zw, h.w);
    vec4 norm = taylorInvSqrt(vec4(dot(p0,p0), dot(p1,p1), dot(p2,p2), dot(p3,p3)));
    p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
    vec4 m = max(0.6 - vec4(dot(x0,x0), dot(x1,x1), dot(x2,x2), dot(x3,x3)), 0.0);
    return 42.0 * dot(m*m*m*m, vec4(dot(p0,x0), dot(p1,x1), dot(p2,x2), dot(p3,x3)));
}

float fbm(vec3 p) {
    float value = 0.0;
    float amplitude = 0.5;
    float frequency = 1.0;
    for(int i = 0; i < 3; i++) {
        value += amplitude * snoise(p * frequency);
        amplitude *= 0.5;
        frequency *= 2.0;
    }
    return value;
}

void main() {
    vec3 dir = normalize(vWorldPosition);
    float t = uTime * 0.02;
    
    // Layered nebula clouds
    vec3 p1 = dir * 2.0 + t * 0.5;
    vec3 p2 = dir * 4.0 - t * 0.3;
    vec3 p3 = dir * 1.5 + vec3(t * 0.2, -t * 0.1, t * 0.15);
    
    float n1 = fbm(p1) * 0.5 + 0.5;
    float n2 = fbm(p2) * 0.5 + 0.5;
    float n3 = fbm(p3) * 0.5 + 0.5;
    
    // Create cloud density
    float density = n1 * n2;
    density = pow(density, 1.5) * 1.5;
    
    // Wispy tendrils
    float tendrils = pow(n3, 3.0) * 0.8;
    
    // Color mixing based on field colors
    vec3 nebulaColor = mix(uColor1 * 0.3, uColor2 * 0.5, n1);
    nebulaColor = mix(nebulaColor, uColor3 * 0.4, n2 * 0.5);
    
    // Add some complementary deep space colors
    vec3 deepSpace = vec3(0.02, 0.01, 0.05);
    vec3 starGlow = vec3(0.1, 0.08, 0.15);
    
    // Audio reactivity
    float bassGlow = uBass * 0.3;
    float midShimmer = uMid * 0.2 * sin(uTime * 2.0 + n1 * 10.0);
    float beatPulse = uBeatEnergy * 0.4;
    
    // Combine layers
    vec3 color = deepSpace;
    color += nebulaColor * density * (0.4 + bassGlow + beatPulse);
    color += uColor2 * 0.15 * tendrils * (1.0 + uHigh * 0.5);
    color += starGlow * pow(n1 * n2, 4.0) * (1.0 + midShimmer);
    
    // Scattered stars
    float stars = pow(snoise(dir * 50.0) * 0.5 + 0.5, 20.0);
    stars += pow(snoise(dir * 80.0 + 100.0) * 0.5 + 0.5, 25.0) * 0.5;
    color += vec3(1.0, 0.95, 0.9) * stars * (0.5 + uHigh * 0.5);
    
    // Vignette toward horizon
    float horizonFade = 1.0 - pow(abs(dir.y), 0.5) * 0.3;
    color *= horizonFade;
    
    // Apply intensity
    color *= uIntensity;
    
    gl_FragColor = vec4(color, 1.0);
}
`;

const nebulaMaterial = new THREE.ShaderMaterial({
  vertexShader: nebulaVertexShader,
  fragmentShader: nebulaFragmentShader,
  uniforms: {
    uTime: { value: 0 },
    uColor1: { value: new THREE.Color(def.c1) },
    uColor2: { value: new THREE.Color(def.c2) },
    uColor3: { value: new THREE.Color(def.c3) },
    uBass: { value: 0 },
    uMid: { value: 0 },
    uHigh: { value: 0 },
    uBeatEnergy: { value: 0 },
    uIntensity: { value: STATE.nebulaIntensity }
  },
  side: THREE.BackSide,
  depthWrite: false
});

const nebulaSphere = new THREE.Mesh(new THREE.SphereGeometry(500, 64, 64), nebulaMaterial);
scene.add(nebulaSphere);

// ═══════ LENS FLARE (3D Object - Cinematic) ═══════
function createSoftGlow(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  grad.addColorStop(0, "rgba(255,250,240,0.9)");
  grad.addColorStop(0.1, "rgba(255,240,230,0.6)");
  grad.addColorStop(0.3, "rgba(200,180,255,0.3)");
  grad.addColorStop(0.6, "rgba(150,120,255,0.1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function createSoftRing(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    size * 0.3,
    size / 2,
    size / 2,
    size * 0.45
  );
  grad.addColorStop(0, "rgba(0,0,0,0)");
  grad.addColorStop(0.4, "rgba(180,160,255,0.15)");
  grad.addColorStop(0.6, "rgba(140,120,220,0.2)");
  grad.addColorStop(0.8, "rgba(100,80,180,0.1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  return new THREE.CanvasTexture(canvas);
}

function createHexagon(size) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d");
  ctx.translate(size / 2, size / 2);
  ctx.beginPath();
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI) / 3 - Math.PI / 6;
    const x = Math.cos(angle) * size * 0.35;
    const y = Math.sin(angle) * size * 0.35;
    i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
  }
  ctx.closePath();
  const grad = ctx.createRadialGradient(0, 0, 0, 0, 0, size * 0.4);
  grad.addColorStop(0, "rgba(150,200,255,0.25)");
  grad.addColorStop(0.7, "rgba(100,150,255,0.1)");
  grad.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = grad;
  ctx.fill();
  return new THREE.CanvasTexture(canvas);
}

const flareGlow = createSoftGlow(256);
const flareRing = createSoftRing(256);
const flareHex = createHexagon(128);

const lensflare = new Lensflare();
lensflare.addElement(new LensflareElement(flareGlow, 180, 0, new THREE.Color(0xffffff)));
lensflare.addElement(new LensflareElement(flareRing, 280, 0, new THREE.Color(0xaaaaff)));
lensflare.addElement(new LensflareElement(flareHex, 60, 0.2, new THREE.Color(0x9999ff)));
lensflare.addElement(new LensflareElement(flareHex, 40, 0.4, new THREE.Color(0xaabbff)));
lensflare.addElement(new LensflareElement(flareGlow, 25, 0.6, new THREE.Color(0x8888ff)));
lensflare.position.set(0, 0, 0);
scene.add(lensflare);

// ═══════ POST-PROCESSING COMPOSER ═══════
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));

const afterimagePass = new AfterimagePass();
// Bright sub-pixel stars must not leave a second visible copy behind them.
// Keep only a nearly-imperceptible temporal blend for motion continuity.
afterimagePass.uniforms["damp"].value = Math.min(0.025, STATE.motionBlurStrength * 0.12);
afterimagePass.enabled = STATE.motionBlurEnabled;
composer.addPass(afterimagePass);

const bloomPass = new UnrealBloomPass(
  new THREE.Vector2(window.innerWidth, window.innerHeight),
  1.5,
  0.4,
  0.85
);
bloomPass.threshold = 0.3;
bloomPass.strength = STATE.bloom;
bloomPass.radius = 0.22;
composer.addPass(bloomPass);

const godRaysPass = new ShaderPass(GodRaysShader);
godRaysPass.enabled = STATE.godRaysEnabled;
godRaysPass.uniforms.uIntensity.value = STATE.godRaysIntensity;
godRaysPass.uniforms.uDecay.value = STATE.godRaysDecay;
composer.addPass(godRaysPass);

const lensFlarePass = new ShaderPass(LensFlareShader);
lensFlarePass.enabled = STATE.lensFlareEnabled;
lensFlarePass.uniforms.uIntensity.value = STATE.lensFlareIntensity;
composer.addPass(lensFlarePass);

const anamorphicPass = new ShaderPass(AnamorphicShader);
anamorphicPass.uniforms.uStretch.value = STATE.anamorphicStretch;
anamorphicPass.enabled = STATE.anamorphicStretch > 0;
composer.addPass(anamorphicPass);

const chromaticPass = new ShaderPass(ChromaticShader);
chromaticPass.uniforms.uIntensity.value = STATE.chromaticAberration;
composer.addPass(chromaticPass);

// Custom DOF pass (radial focus)
const customDOFPass = new ShaderPass(CustomDOFShader);
customDOFPass.uniforms.uFocus.value = STATE.dofFocus;
customDOFPass.uniforms.uFocalLength.value = STATE.dofFocalLength;
customDOFPass.uniforms.uBokehStrength.value = STATE.dofBokehStrength;
customDOFPass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
customDOFPass.enabled = STATE.dofEnabled;
composer.addPass(customDOFPass);

const vignettePass = new ShaderPass(VignetteShader);
composer.addPass(vignettePass);

const grainPass = new ShaderPass(GrainShader);
grainPass.uniforms.uIntensity.value = STATE.filmGrain;
composer.addPass(grainPass);

composer.addPass(new OutputPass());
composer.addPass(
  new ShaderPass({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: `varying vec2 vUv;
                void main() {
                    vUv = uv;
                    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
                }`,
    fragmentShader: `uniform sampler2D tDiffuse;
                varying vec2 vUv;
                 void main() {
                     vec4 color = texture2D(tDiffuse, vUv);
                     vec3 detailLift = pow(max(color.rgb, vec3(0.0)), vec3(0.82)) * 1.2;
                     // The visualizer is an overlay on top of the theme artwork.
                     // Never turn the transparent WebGL clear color into an opaque
                     // black frame: Electron may composite the iframe in a separate
                     // surface where CSS blend modes cannot reveal the layer below.
                     float visibleLight = max(detailLift.r, max(detailLift.g, detailLift.b));
                     float overlayAlpha = clamp(visibleLight * 1.35, 0.0, 1.0);
                     gl_FragColor = vec4(detailLift, overlayAlpha);
                 }`
  })
);

// ═══════ GUI ═══════
const gui = new GUI({ title: "✦ Quantum Fields", width: 320 });
gui.domElement.classList.add("hidden");
gui.domElement.hidden = true;
gui.domElement.inert = true;
gui.domElement.setAttribute("aria-hidden", "true");
// НЕ УДАЛЯТЬ: GUI сохранён для будущей настройки, но полностью скрыт в режиме фона.
listen(document.getElementById("gui-toggle"), "click", () => {
  gui.domElement.classList.toggle("hidden");
});

// === MAIN CONTROLS (always visible) ===
// Animate lil-gui CSS vars toward target field colours
let guiTargetAccent = new THREE.Color(def.c1);
let guiTargetAccent2 = new THREE.Color(def.c2);
let guiCurrentAccent = new THREE.Color(def.c1);
let guiCurrentAccent2 = new THREE.Color(def.c2);

function applyGuiTheme(accent, accent2) {
  // Ensure accent is always bright enough to read against the dark GUI
  const minL = 0.35;
  const lum = accent.r * 0.299 + accent.g * 0.587 + accent.b * 0.114;
  const boost = lum < minL ? minL / Math.max(lum, 0.001) : 1.0;
  const r = Math.min(Math.round(accent.r * boost * 255), 255);
  const g = Math.min(Math.round(accent.g * boost * 255), 255);
  const b = Math.min(Math.round(accent.b * boost * 255), 255);

  // Drive all CSS via :root vars — every purple element in the page recolours
  document.documentElement.style.setProperty("--ar", r);
  document.documentElement.style.setProperty("--ag", g);
  document.documentElement.style.setProperty("--ab", b);

  // Also update lil-gui widget/hover colours (these aren’t driven by :root vars)
  const el = gui.domElement;
  const wR = Math.round((accent.r * 0.4 + accent2.r * 0.3) * 180 + 30);
  const wG = Math.round((accent.g * 0.4 + accent2.g * 0.3) * 180 + 30);
  const wB = Math.round((accent.b * 0.4 + accent2.b * 0.3) * 180 + 30);
  el.style.setProperty("--widget-color", `rgb(${wR},${wG},${wB})`);
  el.style.setProperty(
    "--hover-color",
    `rgb(${Math.min(wR + 25, 255)},${Math.min(wG + 25, 255)},${Math.min(wB + 25, 255)})`
  );
}

// Smooth GUI theme transition in animation loop — interpolates over time
function tickGuiTheme() {
  guiCurrentAccent.lerp(guiTargetAccent, 0.04);
  guiCurrentAccent2.lerp(guiTargetAccent2, 0.04);
  applyGuiTheme(guiCurrentAccent, guiCurrentAccent2);
}

// Set initial theme
applyGuiTheme(guiCurrentAccent, guiCurrentAccent2);

let activeThemePalette = null;
const getActivePalette = () => activeThemePalette || FIELD_TYPES[STATE.field];

function applyFieldAppearance(val) {
  const d = FIELD_TYPES[val];
  const palette = activeThemePalette || d;
  const c1 = new THREE.Color(palette.c1),
    c2 = new THREE.Color(palette.c2),
    c3 = new THREE.Color(palette.c3);
  const sc1 = new THREE.Color(palette.sc1),
    sc2 = new THREE.Color(palette.sc2);
  // Queue GUI theme transition
  guiTargetAccent.set(palette.c1);
  guiTargetAccent2.set(palette.c2);
  function step() {
    material.uniforms.uColor1.value.lerp(c1, 0.05);
    material.uniforms.uColor2.value.lerp(c2, 0.05);
    material.uniforms.uColor3.value.lerp(c3, 0.05);
    secondaryMaterial.uniforms.uColor1.value.lerp(sc1, 0.05);
    secondaryMaterial.uniforms.uColor2.value.lerp(sc2, 0.05);
    nebulaMaterial.uniforms.uColor1.value.lerp(c1, 0.03);
    nebulaMaterial.uniforms.uColor2.value.lerp(c2, 0.03);
    nebulaMaterial.uniforms.uColor3.value.lerp(c3, 0.03);
    connectionMaterial.uniforms.uColor.value.lerp(c2, 0.05);
    connectionMaterial.uniforms.uColor2.value.lerp(c1, 0.05);
    material.uniforms.uNoiseScale.value = THREE.MathUtils.lerp(
      material.uniforms.uNoiseScale.value,
      d.s,
      0.04
    );
    material.uniforms.uCurlStrength.value = THREE.MathUtils.lerp(
      material.uniforms.uCurlStrength.value,
      d.curl,
      0.04
    );
    material.uniforms.uSizeBase.value = THREE.MathUtils.lerp(
      material.uniforms.uSizeBase.value,
      d.sz,
      0.04
    );
    const colorDelta = Math.max(
      Math.abs(material.uniforms.uColor1.value.r - c1.r),
      Math.abs(material.uniforms.uColor1.value.g - c1.g),
      Math.abs(material.uniforms.uColor1.value.b - c1.b),
      Math.abs(material.uniforms.uColor2.value.r - c2.r),
      Math.abs(material.uniforms.uColor2.value.g - c2.g),
      Math.abs(material.uniforms.uColor2.value.b - c2.b),
      Math.abs(material.uniforms.uColor3.value.r - c3.r),
      Math.abs(material.uniforms.uColor3.value.g - c3.g),
      Math.abs(material.uniforms.uColor3.value.b - c3.b)
    );
    if (Math.abs(material.uniforms.uNoiseScale.value - d.s) > 0.01 || colorDelta > 0.01)
      scheduleFrame(step);
  }
  step();
}

gui
  .add(STATE, "field", Object.keys(FIELD_TYPES))
  .name("⚡ Field Type")
  .onChange(applyFieldAppearance);

listen(window, "message", (event) => {
  if (event.source !== window.parent) return;
  if (event.data?.type === "QFT_AUDIO") {
    AUDIO.applyExternalSpectrum(event.data.bands, event.data.bass, event.data.active);
    return;
  }
  if (event.data?.type === "QFT_POINTER") {
    backdropTargetX = -THREE.MathUtils.clamp(Number(event.data.x) || 0, -1, 1) * 18;
    backdropTargetY = -THREE.MathUtils.clamp(Number(event.data.y) || 0, -1, 1) * 12;
    return;
  }
  if (event.data?.type !== "QFT_THEME") return;
  const palette = event.data.palette;
  if (
    !palette ||
    !["primary", "primaryHover", "secondary", "accent", "highlight"].every(
      (key) => typeof palette[key] === "string"
    )
  )
    return;

  const backgroundImage =
    typeof event.data.backgroundImage === "string" ? event.data.backgroundImage : "none";
  const backgroundColor =
    typeof event.data.backgroundColor === "string" ? event.data.backgroundColor : "#000000";
  for (const element of [document.documentElement, document.body]) {
    element.style.backgroundColor = backgroundColor;
  }
  themeBackdrop.style.backgroundColor = backgroundColor;
  themeBackdrop.style.backgroundImage = backgroundImage;

  const lightTheme = event.data.theme === "light";
  const renderColor = (value) => {
    if (!lightTheme) return value;
    const match = /^#([0-9a-f]{6})$/i.exec(value.trim());
    if (!match) return value;
    const inverted = [0, 2, 4]
      .map((offset) =>
        (255 - Number.parseInt(match[1].slice(offset, offset + 2), 16))
          .toString(16)
          .padStart(2, "0")
      )
      .join("");
    return `#${inverted}`;
  };
  activeThemePalette = {
    c1: renderColor(palette.primary),
    c2: renderColor(palette.accent),
    c3: renderColor(palette.highlight),
    sc1: renderColor(palette.primaryHover),
    sc2: renderColor(palette.secondary)
  };
  applyFieldAppearance(STATE.field);
});
window.parent.postMessage({ type: "QFT_READY" }, "*");
gui.add(STATE, "sensitivity", 0.1, 3.0).name("🎧 Audio Sensitivity");
gui
  .add(STATE, "density", 0.017, 0.14)
  .name("⭐ Density")
  .onChange((v) =>
    geometry.setDrawRange(0, Math.floor((CONFIG.maxParticles + CONFIG.secondaryParticles) * v))
  );
gui.add(STATE, "timeScale", 0.0, 3.0).name("⏱ Time Flow");

// === ENVIRONMENT ===
const f_env = gui.addFolder("🌌 Environment");
f_env
  .add(STATE, "nebulaEnabled")
  .name("Space Nebula")
  .onChange((v) => (nebulaSphere.visible = v));
f_env
  .add(STATE, "nebulaIntensity", 0.0, 2.0)
  .name("Nebula Intensity")
  .onChange((v) => (nebulaMaterial.uniforms.uIntensity.value = v));
f_env.add(STATE, "connectionsEnabled").name("Force Network");
f_env.add(STATE, "connectionThreshold", 5.0, 25.0).name("Network Range");
f_env.add(STATE, "connectionOpacity", 0.1, 1.0).name("Network Opacity");
f_env.add(STATE, "crawlersEnabled").name("Network Crawlers");
f_env.add(STATE, "particleTrailsEnabled").name("Particle Trails");
f_env.add(STATE, "particleTrailOpacity", 0.0, 1.0).name("Trail Opacity");
f_env.close();

// === CAMERA & LENS ===
const f_lens = gui.addFolder("🎥 Camera & Lens");
f_lens
  .add(STATE, "lensFlareEnabled")
  .name("Lens Flare")
  .onChange((v) => {
    lensFlarePass.enabled = v;
    lensflare.visible = v;
  });
f_lens
  .add(STATE, "lensFlareIntensity", 0.0, 2.0)
  .name("Flare Intensity")
  .onChange((v) => (lensFlarePass.uniforms.uIntensity.value = v));
const dofController = f_lens
  .add(STATE, "dofEnabled")
  .name("Depth of Field")
  .onChange((v) => (customDOFPass.enabled = v));
f_lens
  .add(STATE, "dofFocus", 0.0, 0.1015)
  .name("Focus Ring")
  .onChange((v) => (customDOFPass.uniforms.uFocus.value = v));
f_lens
  .add(STATE, "dofFocalLength", 0.05, 0.5)
  .name("Focus Falloff")
  .onChange((v) => (customDOFPass.uniforms.uFocalLength.value = v));
f_lens
  .add(STATE, "dofBokehStrength", 0.0, 1.0)
  .name("Blur Amount")
  .onChange((v) => (customDOFPass.uniforms.uBokehStrength.value = v));
f_lens.add(STATE, "cameraShake", 0.0, 2.0).name("Camera Shake");
f_lens.close();

// === POST FX ===
const f_post = gui.addFolder("✨ Post Processing");
f_post.add(bloomPass, "strength", 0.0, 3.0).name("Bloom");
f_post.add(afterimagePass.uniforms["damp"], "value", 0.5, 0.98).name("Motion Blur");
f_post
  .add(STATE, "chromaticAberration", 0.0, 0.025)
  .name("Chromatic")
  .onChange((v) => (chromaticPass.uniforms.uIntensity.value = v));
f_post
  .add(STATE, "anamorphicStretch", 0.0, 1.0)
  .name("Anamorphic")
  .onChange((v) => {
    anamorphicPass.uniforms.uStretch.value = v;
    anamorphicPass.enabled = v > 0;
  });
f_post
  .add(STATE, "godRaysEnabled")
  .name("God Rays")
  .onChange((v) => (godRaysPass.enabled = v));
f_post
  .add(STATE, "godRaysIntensity", 0.0, 1.0)
  .name("Rays Intensity")
  .onChange((v) => (godRaysPass.uniforms.uIntensity.value = v));
f_post
  .add(STATE, "filmGrain", 0.0, 0.2)
  .name("Film Grain")
  .onChange((v) => (grainPass.uniforms.uIntensity.value = v));
f_post.close();

// === PHYSICS (Advanced) ===
const f_phys = gui.addFolder("⚙️ Physics");
f_phys
  .add(STATE, "vortexStrength", 0.0, 1.0)
  .name("Vortex")
  .onChange((v) => (material.uniforms.uVortexStrength.value = v));
f_phys
  .add(STATE, "pulseIntensity", 0.0, 2.5)
  .name("Pulse")
  .onChange((v) => (material.uniforms.uPulseIntensity.value = v));
f_phys.close();

// === AUDIO (Advanced) ===
const f_gate = gui.addFolder("🎤 Audio Gate");
f_gate.add(STATE, "bassGateEnabled").name("Enable");
f_gate.add(STATE, "bassGateThreshold", 0.0, 0.5).name("Threshold");
f_gate.add(STATE, "bassGateAttack", 0.01, 0.3).name("Attack");
f_gate.add(STATE, "bassGateRelease", 0.05, 0.5).name("Release");
f_gate.close();

// === ENHANCEMENT PACK v2.0 ===
const f_enhance = gui.addFolder("🚀 Enhancement Pack");
f_enhance.add(STATE, "onsetSensitivity", 0.5, 3.0).name("Onset Punch");
f_enhance.add(STATE, "audioCameraEnabled").name("Audio Camera");
f_enhance.add(STATE, "audioCameraIntensity", 0.0, 1.0).name("Camera React");
f_enhance.add(STATE, "waveformTerrainHeight", 5.0, 30.0).name("Terrain Height");
f_enhance.add(STATE, "adaptiveQualityEnabled").name("Auto Quality");
f_enhance.add(STATE, "targetFPS", 30, 60).name("Target FPS");
f_enhance
  .add({ fps: () => QUALITY_SYSTEM.currentFPS.toFixed(1) }, "fps")
  .name("Current FPS")
  .listen();
f_enhance.close();

let settingsLogTimer;
const scheduleSettingsLog = (changed = null) => {
  clearTimeout(settingsLogTimer);
  settingsLogTimer = setTimeout(() => {
    const snapshot = {
      ...STATE,
      bloom: bloomPass.strength,
      trails: afterimagePass.uniforms["damp"].value
    };
    const serialized = JSON.stringify(snapshot);
    window.__QFT_LAST_SETTINGS__ = serialized;
    document.documentElement.dataset.qftSettings = serialized;
    window.parent.postMessage(
      {
        type: "QFT_SETTINGS",
        changed,
        serialized
      },
      "*"
    );
  }, 150);
};
gui.onChange(({ property, value }) => scheduleSettingsLog({ property, value }));
listen(gui.domElement, "input", () => scheduleSettingsLog(), true);
listen(gui.domElement, "change", () => scheduleSettingsLog(), true);

// ═══════ UI & EVENTS ═══════
const overlay = document.getElementById("overlay");
const audioControls = document.getElementById("audio-controls");
const playPauseBtn = document.getElementById("play-pause-btn");
const progressBar = document.getElementById("progress-bar");
const progressContainer = document.getElementById("progress-container");
const timeDisplay = document.getElementById("time-display");
const trackName = document.getElementById("track-name");
const status = document.getElementById("status-bar");

const formatTime = (s) =>
  `${Math.floor(s / 60)}:${Math.floor(s % 60)
    .toString()
    .padStart(2, "0")}`;

function updateUI() {
  if (!playPauseBtn || !progressBar || !timeDisplay) return;
  if (AUDIO.mode === "mic") {
    playPauseBtn.textContent = "🎙 live";
    playPauseBtn.disabled = true;
  } else {
    playPauseBtn.textContent = AUDIO.isPlaying ? "⏸ pause" : "▶ play";
    playPauseBtn.classList.toggle("playing", AUDIO.isPlaying);
    playPauseBtn.disabled = false;
  }
  if (AUDIO.mode === "file" && AUDIO.audioBuffer) {
    const cur = AUDIO.getCurrentTime(),
      dur = AUDIO.getDuration();
    progressBar.style.width = (cur / dur) * 100 + "%";
    timeDisplay.textContent = `${formatTime(cur)} / ${formatTime(dur)}`;
  } else {
    progressBar.style.width = "0%";
    timeDisplay.textContent = AUDIO.mode === "mic" ? "LIVE" : "0:00 / 0:00";
  }
}

function togglePlayPause() {
  if (AUDIO.mode !== "file") return;
  AUDIO.togglePlayPause();
  updateUI();
  if (status)
    status.innerHTML = AUDIO.isPlaying
      ? "SYSTEM: <span>PLAYING</span>"
      : "SYSTEM: <span>PAUSED</span>";
}

function activate() {
  AUDIO.init();
  if (AUDIO.ctx.state === "suspended") AUDIO.ctx.resume();
  if (overlay) {
    overlay.style.opacity = 0;
    setTimeout(() => (overlay.style.display = "none"), 800);
  }
  audioControls?.classList.add("visible");
}

async function loadTrack(file) {
  activate();
  await AUDIO.loadTrack(await file.arrayBuffer(), file.name);
  AUDIO.play();
  if (trackName)
    trackName.textContent = file.name.length > 25 ? file.name.slice(0, 22) + "..." : file.name;
  updateUI();
  if (status) status.innerHTML = "SYSTEM: <span>PLAYING</span>";
}

async function startMic(preferredLabel = null) {
  console.log("Global startMic requested:", preferredLabel);
  try {
    activate();
    await AUDIO.startMic(preferredLabel);
    if (trackName) trackName.textContent = AUDIO.currentTrackName;
    updateUI();
    // status update handled in AUDIO.startMic
  } catch (e) {
    console.error("Global startMic failed:", e);
    const status = document.getElementById("status-bar");
    if (status) status.innerHTML = `ERROR: <span style="color:#ff6b6b">${e.message}</span>`;
  }
}

// Using optional chaining/checks because one input was replaced by a button
const enterBtn = document.getElementById("enter-btn");
if (enterBtn) enterBtn.onclick = () => startMic(null);

const fileInput = document.getElementById("file-input");
if (fileInput) fileInput.onchange = (e) => e.target.files[0] && loadTrack(e.target.files[0]);

const fileInput2 = document.getElementById("file-input-2");
if (fileInput2)
  fileInput2.onchange = (e) => {
    if (e.target.files[0]) loadTrack(e.target.files[0]);
    e.target.value = "";
  };
const micBtn2 = document.getElementById("mic-btn-2");
if (micBtn2) micBtn2.onclick = () => startMic(null);
if (playPauseBtn) playPauseBtn.onclick = togglePlayPause;
if (progressContainer)
  progressContainer.onclick = (e) => {
    if (AUDIO.mode !== "file" || !AUDIO.audioBuffer) return;
    const rect = progressContainer.getBoundingClientRect();
    AUDIO.seek(((e.clientX - rect.left) / rect.width) * AUDIO.getDuration());
  };
listen(document.getElementById("screenshot-btn"), "click", () => {
  composer.render();
  const a = document.createElement("a");
  a.download = "quantum-" + Date.now() + ".png";
  a.href = renderer.domElement.toDataURL("image/png");
  a.click();
});
listen(document.getElementById("fullscreen-btn"), "click", () => {
  document.fullscreenElement
    ? document.exitFullscreen()
    : document.documentElement.requestFullscreen();
});

// ═══════ ANIMATION LOOP ═══════
const clock = new THREE.Timer();
clock.connect(document);

function animate(timestamp) {
  scheduleFrame(animate);
  clock.update(timestamp);
  const dt = clock.getDelta(),
    elapsed = clock.getElapsed();

  backdropX += (backdropTargetX - backdropX) * 0.085;
  backdropY += (backdropTargetY - backdropY) * 0.085;
  themeBackdrop.style.transform = `translate3d(${backdropX.toFixed(2)}px, ${backdropY.toFixed(2)}px, 0) scale(1.055)`;

  material.uniforms.uTime.value += dt * STATE.timeScale;
  grainPass.uniforms.uTime.value = elapsed;
  lensFlarePass.uniforms.uTime.value = elapsed;

  material.uniforms.uZoomFactor.value = camera.position.length() / CONFIG.defaultZoom;
  const audioActivity = AUDIO.active && AUDIO.isPlaying ? 1 : 0;
  material.uniforms.uAudioActivity.value = THREE.MathUtils.lerp(
    material.uniforms.uAudioActivity.value,
    audioActivity,
    0.08
  );
  material.uniforms.uMousePos.value.lerp(mouseWorldPos, 0.1);
  material.uniforms.uMouseVelocity.value.lerp(mouseVelocity, 0.08);

  AUDIO.update();
  updateUI();

  const s = STATE.sensitivity,
    lf = 0.16;
  material.uniforms.uSubBass.value = THREE.MathUtils.lerp(
    material.uniforms.uSubBass.value,
    AUDIO.gatedBands.subBass * s,
    lf
  );
  material.uniforms.uBass.value = THREE.MathUtils.lerp(
    material.uniforms.uBass.value,
    AUDIO.gatedBands.bass * s,
    lf
  );
  material.uniforms.uLowMid.value = THREE.MathUtils.lerp(
    material.uniforms.uLowMid.value,
    AUDIO.gatedBands.lowMid * s,
    lf
  );
  material.uniforms.uMid.value = THREE.MathUtils.lerp(
    material.uniforms.uMid.value,
    AUDIO.gatedBands.mid * s,
    lf
  );
  material.uniforms.uHighMid.value = THREE.MathUtils.lerp(
    material.uniforms.uHighMid.value,
    AUDIO.gatedBands.highMid * s,
    lf
  );
  material.uniforms.uHigh.value = THREE.MathUtils.lerp(
    material.uniforms.uHigh.value,
    AUDIO.gatedBands.high * s,
    lf
  );
  material.uniforms.uUltraHigh.value = THREE.MathUtils.lerp(
    material.uniforms.uUltraHigh.value,
    AUDIO.gatedBands.ultraHigh * s,
    lf
  );
  material.uniforms.uBeatEnergy.value = THREE.MathUtils.lerp(
    material.uniforms.uBeatEnergy.value,
    AUDIO.beatEnergy,
    0.22
  );
  material.uniforms.uSpectralCentroid.value = THREE.MathUtils.lerp(
    material.uniforms.uSpectralCentroid.value,
    AUDIO.spectralCentroid,
    lf
  );
  material.uniforms.uSpectralFlux.value = THREE.MathUtils.lerp(
    material.uniforms.uSpectralFlux.value,
    AUDIO.spectralFlux * s,
    lf
  );

  // === ENHANCEMENT: Update new uniforms ===
  material.uniforms.uOnsetEnergy.value = THREE.MathUtils.lerp(
    material.uniforms.uOnsetEnergy.value,
    AUDIO.onsetEnergy,
    0.25
  );
  material.uniforms.uTerrainMode.value = FIELD_TYPES[STATE.field]?.terrain ? 1.0 : 0.0;
  material.uniforms.uTerrainHeight.value = STATE.waveformTerrainHeight;

  // Update secondary particles
  secondaryPoints.visible = STATE.secondaryEnabled;
  secondaryMaterial.uniforms.uTime.value = material.uniforms.uTime.value;
  secondaryMaterial.uniforms.uSubBass.value = material.uniforms.uSubBass.value;
  secondaryMaterial.uniforms.uBass.value = material.uniforms.uBass.value;
  secondaryMaterial.uniforms.uLowMid.value = material.uniforms.uLowMid.value;
  secondaryMaterial.uniforms.uMid.value = material.uniforms.uMid.value;
  secondaryMaterial.uniforms.uHighMid.value = material.uniforms.uHighMid.value;
  secondaryMaterial.uniforms.uHigh.value = material.uniforms.uHigh.value;
  secondaryMaterial.uniforms.uUltraHigh.value = material.uniforms.uUltraHigh.value;
  secondaryMaterial.uniforms.uBeatEnergy.value = material.uniforms.uBeatEnergy.value;
  secondaryMaterial.uniforms.uSpectralCentroid.value = material.uniforms.uSpectralCentroid.value;
  secondaryMaterial.uniforms.uSpectralFlux.value = material.uniforms.uSpectralFlux.value;
  secondaryMaterial.uniforms.uOnsetEnergy.value = material.uniforms.uOnsetEnergy.value;
  secondaryMaterial.uniforms.uVortexStrength.value = STATE.vortexStrength;
  secondaryMaterial.uniforms.uAudioActivity.value = material.uniforms.uAudioActivity.value;

  // Update nebula background
  nebulaSphere.visible = STATE.nebulaEnabled;
  if (STATE.nebulaEnabled) {
    nebulaMaterial.uniforms.uTime.value = material.uniforms.uTime.value;
    nebulaMaterial.uniforms.uBass.value = material.uniforms.uBass.value;
    nebulaMaterial.uniforms.uMid.value = material.uniforms.uMid.value;
    nebulaMaterial.uniforms.uHigh.value = material.uniforms.uHigh.value;
    nebulaMaterial.uniforms.uBeatEnergy.value = material.uniforms.uBeatEnergy.value;
  }

  // Update particle connections
  connectionMesh.visible = STATE.connectionsEnabled;
  if (STATE.connectionsEnabled) {
    updateConnections(
      STATE.connectionThreshold,
      material.uniforms.uBass.value,
      material.uniforms.uHighMid.value,
      material.uniforms.uMid.value
    );
    connectionMaterial.uniforms.uBeatEnergy.value = material.uniforms.uBeatEnergy.value;
    connectionMaterial.uniforms.uOnsetEnergy.value = material.uniforms.uOnsetEnergy.value;
    connectionMaterial.uniforms.uBass.value = material.uniforms.uBass.value;
    connectionMaterial.uniforms.uHighMid.value = material.uniforms.uHighMid.value;
    connectionMaterial.uniforms.uSpectralCentroid.value = material.uniforms.uSpectralCentroid.value;
    connectionMaterial.uniforms.uOpacity.value = STATE.connectionOpacity;
  }

  // Update crawlers
  crawlerMesh.visible =
    STATE.crawlersEnabled &&
    STATE.connectionsEnabled &&
    AUDIO.active &&
    (AUDIO.isPlaying || AUDIO.mode === "mic");
  if (crawlerMesh.visible) {
    updateCrawlers(
      dt,
      material.uniforms.uHighMid.value,
      material.uniforms.uBeatEnergy.value,
      material.uniforms.uSpectralCentroid.value
    );
    crawlerMaterial.uniforms.uColor.value.lerp(
      new THREE.Color().lerpColors(
        new THREE.Color(getActivePalette()?.c1 || "#ffffff"),
        new THREE.Color(getActivePalette()?.c3 || "#ffffff"),
        material.uniforms.uSpectralCentroid.value
      ),
      0.05
    );
    crawlerMaterial.uniforms.uBeatEnergy.value = material.uniforms.uBeatEnergy.value;
  }

  // Tick GUI theme transition
  tickGuiTheme();

  // Update post-processing
  afterimagePass.enabled = STATE.motionBlurEnabled;
  afterimagePass.uniforms["damp"].value = Math.min(0.025, STATE.motionBlurStrength * 0.12);
  chromaticPass.uniforms.uBeatEnergy.value = material.uniforms.uBeatEnergy.value;
  godRaysPass.uniforms.uBeatEnergy.value = material.uniforms.uBeatEnergy.value;
  lensFlarePass.uniforms.uBeatEnergy.value = material.uniforms.uBeatEnergy.value;
  vignettePass.uniforms.uBeatEnergy.value = material.uniforms.uBeatEnergy.value;
  customDOFPass.uniforms.uBeatEnergy.value = material.uniforms.uBeatEnergy.value;

  // Update trails
  trailSystem.update(
    elapsed,
    {
      bass: material.uniforms.uBass.value,
      mid: material.uniforms.uMid.value,
      high: material.uniforms.uHigh.value,
      highMid: material.uniforms.uHighMid.value,
      beat: material.uniforms.uBeatEnergy.value,
      onset: material.uniforms.uOnsetEnergy.value
    },
    material.uniforms.uColor1.value
  );

  // Update lens flare
  if (STATE.lensFlareEnabled) {
    lensflare.visible = false;
    lensflare.scale.setScalar((1.0 + AUDIO.beatEnergy * 0.5) * STATE.lensFlareIntensity);
    lensflare.position.y = Math.sin(elapsed * 0.5) * 5 * material.uniforms.uBass.value;
  } else {
    lensflare.visible = false;
  }

  // === ENHANCEMENT: Adaptive Quality System ===
  QUALITY_SYSTEM.update(dt * 1000);

  // === ENHANCEMENT: Audio-Reactive Camera ===
  AUDIO_CAMERA.update(dt * 1000);

  // Camera shake
  if (STATE.cameraShake > 0 && AUDIO.beatEnergy > 0.1) {
    const shake = AUDIO.beatEnergy * STATE.cameraShake;
    cameraShakeOffset.set(
      (Math.random() - 0.5) * shake * 0.6,
      (Math.random() - 0.5) * shake * 0.4,
      (Math.random() - 0.5) * shake * 0.25
    );
    camera.position.copy(baseCameraPos).add(cameraShakeOffset);
  }

  controls.autoRotateSpeed =
    0.35 + material.uniforms.uMid.value * 0.8 + material.uniforms.uBeatEnergy.value * 0.8;
  const bloomBase = STATE.bloom * (audioActivity > 0.5 ? 0.55 : 1.0);
  bloomPass.strength =
    bloomBase + (AUDIO.gatedBands.bass + AUDIO.gatedBands.mid + AUDIO.beatEnergy) / 24;
  if (anamorphicPass.enabled)
    anamorphicPass.uniforms.uIntensity.value = 0.3 + AUDIO.gatedBands.bass * 0.4;
  const targetExposure = audioActivity > 0.5 ? 1.55 : 2.1;
  renderer.toneMappingExposure = THREE.MathUtils.lerp(
    renderer.toneMappingExposure,
    targetExposure,
    0.06
  );

  controls.update();
  composer.render();
}

listen(window, "resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  composer.setSize(window.innerWidth, window.innerHeight);
  customDOFPass.uniforms.uResolution.value.set(window.innerWidth, window.innerHeight);
  baseCameraPos.copy(camera.position);
});

// НЕ УДАЛЯТЬ: локальный микрофон/loopback оставлен для будущей ручной настройки.
// В режиме фона аудиореакция приходит напрямую из анализатора радио приложения.

function dispose() {
  if (disposed) return;
  disposed = true;
  clearTimeout(settingsLogTimer);
  for (const id of scheduledFrames) cancelAnimationFrame(id);
  scheduledFrames.clear();
  for (const [target, type, handler, options] of lifecycleListeners.splice(0)) {
    target.removeEventListener?.(type, handler, options);
  }
  AUDIO.stopCurrentSource();
  try {
    AUDIO.analyser?.disconnect?.();
  } catch (e) {}
  AUDIO.active = false;
  AUDIO.ctx?.close?.().catch?.(() => {});
  AUDIO.ctx = null;
  clock.disconnect?.();
  controls.dispose?.();
  gui.destroy?.();
  scene.traverse((object) => {
    object.geometry?.dispose?.();
    const materials = Array.isArray(object.material) ? object.material : [object.material];
    for (const item of materials) {
      if (!item) continue;
      for (const value of Object.values(item)) {
        if (value?.isTexture) value.dispose?.();
      }
      item.dispose?.();
    }
  });
  composer.dispose?.();
  renderer.dispose?.();
  renderer.forceContextLoss?.();
  renderer.domElement.remove();
  themeBackdrop.remove();
  window.parent.postMessage({ type: "QFT_DISPOSED" }, "*");
}

window.__QFT_DISPOSE__ = dispose;
listen(window, "pagehide", dispose, { once: true });
listen(window, "beforeunload", dispose, { once: true });
listen(window, "message", (event) => {
  if (event.source === window.parent && event.data?.type === "QFT_DISPOSE") dispose();
});

animate();
