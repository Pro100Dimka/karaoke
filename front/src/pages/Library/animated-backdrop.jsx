/* eslint-disable prefer-exponentiation-operator */
/* eslint-disable no-restricted-properties */
import { useEffect, useRef } from "react";
import * as THREE from "three";

const MAX_PARTICLES = 250000;
const DENSITY = 0.043;
const FIELD_RADIUS = 90;

const VERTEX_SHADER = `
uniform float uTime;
uniform float uPixelRatio;
uniform float uSizeBase;
uniform float uNoiseScale;
uniform float uCurlStrength;
uniform float uRadius;

uniform vec3 uColor1;
uniform vec3 uColor2;
uniform vec3 uColor3;

uniform float uSubBass;
uniform float uBass;
uniform float uLowMid;
uniform float uMid;
uniform float uHighMid;
uniform float uHigh;
uniform float uUltraHigh;

uniform float uBeatEnergy;
uniform float uSpectralCentroid;
uniform float uSpectralFlux;
uniform float uOnsetEnergy;
uniform float uTerrainMode;
uniform float uTerrainHeight;
uniform float uVortexStrength;
uniform float uPulseIntensity;
uniform float uZoomFactor;
uniform float uBassMotion;

attribute vec3 aRandom;
attribute float aPhase;
attribute float aLayer;

varying vec3 vColor;
varying float vAlpha;
varying float vEnergy;
varying float vDepth;
varying float vRimLight;

vec3 mod289(vec3 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 mod289(vec4 x) {
  return x - floor(x * (1.0 / 289.0)) * 289.0;
}

vec4 permute(vec4 x) {
  return mod289(((x * 34.0) + 1.0) * x);
}

vec4 taylorInvSqrt(vec4 r) {
  return 1.79284291400159 - 0.85373472095314 * r;
}

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
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

  vec4 p = permute(
    permute(
      permute(i.z + vec4(0.0, i1.z, i2.z, 1.0))
        + i.y + vec4(0.0, i1.y, i2.y, 1.0)
    )
      + i.x + vec4(0.0, i1.x, i2.x, 1.0)
  );

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

  vec4 norm = taylorInvSqrt(
    vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3))
  );

  p0 *= norm.x;
  p1 *= norm.y;
  p2 *= norm.z;
  p3 *= norm.w;

  vec4 m = max(
    0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)),
    0.0
  );

  m = m * m;

  return 42.0 * dot(
    m * m,
    vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3))
  );
}

vec3 curl(float x, float y, float z) {
  float eps = 0.08;

  return vec3(
    snoise(vec3(x, y + eps, z)) - snoise(vec3(x, y - eps, z)),
    snoise(vec3(x, y, z + eps)) - snoise(vec3(x, y, z - eps)),
    snoise(vec3(x + eps, y, z)) - snoise(vec3(x - eps, y, z))
  );
}

void main() {
  float t = uTime * (1.0 + uMid * 0.5);
  vec3 noisePos = position * 0.035 + aRandom;
  float layerMod = 1.0 + aLayer * 0.5;

  vec3 flow1 = curl(
    noisePos.x * uNoiseScale + t * 0.1,
    noisePos.y * uNoiseScale,
    noisePos.z * uNoiseScale
  );

  vec3 flow2 = curl(
    noisePos.x * uNoiseScale * 2.2 + t * 0.07,
    noisePos.y * uNoiseScale * 2.2 + t * 0.08,
    noisePos.z * uNoiseScale * 2.2
  ) * 0.4;

  vec3 flow3 = curl(
    noisePos.x * uNoiseScale * 0.5 - t * 0.05,
    noisePos.y * uNoiseScale * 0.5,
    noisePos.z * uNoiseScale * 0.5
  ) * 0.6 * uLowMid;

  vec3 flow = flow1 + flow2 * uHigh + flow3;

  vec3 newPos =
    position +
    flow * uCurlStrength * layerMod * (1.0 + uSpectralFlux * 2.5);

  float distFromCenter = length(newPos.xz);
  float vortexAngle =
    uVortexStrength *
    uBass *
    3.5 /
    (1.0 + distFromCenter * 0.08);

  float cosA = cos(vortexAngle);
  float sinA = sin(vortexAngle);

  vec2 rotated = vec2(
    newPos.x * cosA - newPos.z * sinA,
    newPos.x * sinA + newPos.z * cosA
  );

  newPos.xz = mix(
    newPos.xz,
    rotated,
    uBass * uVortexStrength
  );

  float yVortex =
    sin(newPos.y * 0.1 + uTime) *
    uMid *
    uVortexStrength *
    2.0;

  newPos.x += cos(newPos.y * 0.15) * yVortex;
  newPos.z += sin(newPos.y * 0.15) * yVortex;

  float distToCenter = length(newPos);
  vec3 centerDir = normalize(newPos + vec3(0.001));

  float beatRing =
    sin(distToCenter * 0.25 - uTime * 6.0) *
    uBeatEnergy *
    uPulseIntensity;

  newPos += centerDir * beatRing * 3.5;

  float breathing =
    sin(uTime * 1.8 + aPhase) *
    uSubBass *
    4.0;

  newPos +=
    centerDir *
    breathing *
    exp(-distToCenter * 0.04);

  newPos +=
    centerDir *
    smoothstep(0.3, 0.8, uBass) *
    6.0 *
    exp(-distToCenter * 0.06);

  float onsetPunch =
    uOnsetEnergy *
    8.0 *
    exp(-distToCenter * 0.03);

  newPos += centerDir * onsetPunch;

  if (uTerrainMode > 0.5) {
    float gridX =
      floor(position.x * 0.5 + 64.0) /
      128.0;

    float gridZ =
      floor(position.z * 0.5 + 64.0) /
      128.0;

    float freqBin = gridX;

    float waveHeight =
      uBass *
      sin(freqBin * 6.28 * 8.0 + uTime * 3.0) *
      0.5;

    waveHeight +=
      uMid *
      sin(freqBin * 6.28 * 16.0 + uTime * 5.0) *
      0.3;

    waveHeight +=
      uHigh *
      sin(freqBin * 6.28 * 32.0 + uTime * 8.0) *
      0.2;

    waveHeight *=
      1.0 + uSpectralFlux * 3.0;

    float terrainY =
      waveHeight *
      uTerrainHeight;

    terrainY +=
      sin(gridZ * 6.28 * 4.0 + uTime) *
      uSubBass *
      5.0;

    float terrainBlend =
      smoothstep(
        0.0,
        30.0,
        abs(position.y)
      );

    newPos.y =
      mix(
        terrainY,
        newPos.y,
        terrainBlend
      );

    newPos.xz =
      mix(
        vec2(
          gridX * 150.0 - 75.0,
          gridZ * 150.0 - 75.0
        ),
        newPos.xz,
        terrainBlend * 0.3
      );
  }

  // Bass-synchronised chaotic motion.
  // IMPORTANT: there is NO independent time-based oscillation here.
  // Every point moves only when the current bass envelope changes.
  if (uBassMotion > 0.001) {
    float bass = clamp(uBassMotion, 0.0, 1.5);

    vec3 randomDirection = normalize(
      (aRandom - vec3(0.5)) * 2.0 +
      vec3(
        sin(aPhase * 1.7),
        cos(aPhase * 2.3),
        sin(aPhase * 3.1)
      ) * 0.55 +
      vec3(0.001)
    );

    vec3 secondDirection = normalize(
      vec3(
        aRandom.y - aRandom.z,
        aRandom.z - aRandom.x,
        aRandom.x - aRandom.y
      ) +
      vec3(
        cos(aPhase * 2.9),
        sin(aPhase * 1.3),
        cos(aPhase * 3.7)
      ) * 0.35 +
      vec3(0.001)
    );

    // Different points have different travel ranges, but they ALL follow
    // the same live bass envelope: bass up -> scatter, bass down -> return.
    float personalRange =
      0.45 +
      aRandom.x * 0.90 +
      aRandom.y * 0.35;

    float travel =
      pow(bass, 1.18) *
      (7.0 + bass * 22.0) *
      personalRange;

    float secondaryTravel =
      pow(bass, 1.65) *
      (2.0 + bass * 8.0) *
      (0.35 + aRandom.z * 0.65);

    // Opposite reaction:
    // on a bass hit the particles move INWARD / compress,
    // then as uBassMotion decays to 0 they return to their idle positions.
    newPos -= randomDirection * travel;
    newPos -= secondDirection * secondaryTravel;
  }

  vec4 mvPosition =
    modelViewMatrix *
    vec4(newPos, 1.0);

  gl_Position =
    projectionMatrix *
    mvPosition;

  float size =
    uSizeBase *
    (0.85 + uBass * 0.5 + uBeatEnergy * 0.5) *
    (1.0 + (uZoomFactor - 1.0) * 0.3);

  size *=
    1.0 +
    sin(uTime * 10.0 + aPhase * 6.28) *
    uHigh *
    0.35;

  gl_PointSize =
    clamp(
      size *
      uPixelRatio *
      (90.0 / -mvPosition.z) *
      layerMod,
      0.5,
      120.0
    );

  float colorMix =
    smoothstep(
      0.0,
      2.8,
      length(flow) + uHighMid * 3.0
    );

  vec3 baseColor =
    mix(
      uColor1,
      uColor2,
      colorMix
    );

  baseColor =
    mix(
      baseColor,
      uColor3,
      uSpectralCentroid *
      uHigh *
      2.5
    );

  float energyLevel =
    uBeatEnergy * 0.35 +
    uSpectralFlux * 0.8;

  vColor =
    mix(
      baseColor,
      vec3(1.0),
      energyLevel * 0.4
    );

  vColor +=
    vec3(0.08, 0.04, 0.12) *
    uUltraHigh *
    2.5;

  vRimLight =
    pow(
      1.0 -
      max(
        0.0,
        dot(
          normalize(-mvPosition.xyz),
          normalize(newPos)
        )
      ),
      3.0
    );

  vEnergy = energyLevel;

  vDepth =
    clamp(
      -mvPosition.z / 120.0,
      0.0,
      1.0
    );

  float alpha =
    1.0 -
    smoothstep(
      uRadius * 0.7,
      uRadius,
      distToCenter
    );

  float sparkle =
    1.0 +
    (
      aRandom.x > 0.8
        ? sin(
            uTime * 20.0 +
            aRandom.y * 150.0
          ) *
          uHigh *
          2.5
        : 0.0
    );

  vAlpha =
    alpha *
    sparkle *
    (0.7 + uMid * 0.35) *
    layerMod;
}
`;

const FRAGMENT_SHADER = `
varying vec3 vColor;
varying float vAlpha;
varying float vEnergy;
varying float vDepth;
varying float vRimLight;

void main() {
  vec2 xy =
    gl_PointCoord.xy -
    vec2(0.5);

  float r =
    length(xy);

  if (r > 0.5) {
    discard;
  }

  float core =
    smoothstep(
      0.16 - vEnergy * 0.04,
      0.12 - vEnergy * 0.04,
      r
    );

  float glow =
    exp(
      -r * r *
      (20.0 - vEnergy * 10.0)
    );

  float halo =
    exp(-r * r * 5.0) * 0.35 +
    exp(-r * r * 2.5) * 0.15;

  vec3 finalColor =
    mix(
      vColor,
      vec3(1.0, 0.95, 0.9),
      core * 0.7
    );

  finalColor +=
    vec3(0.2, 0.3, 0.4) *
    vRimLight *
    0.3;

  finalColor =
    mix(
      finalColor,
      vec3(0.02, 0.03, 0.05),
      vDepth * 0.4
    );

  float finalAlpha =
    clamp(
      vAlpha *
      (
        glow +
        halo +
        pow(
          1.0 - r * 2.0,
          2.5
        ) *
        0.6
      ),
      0.0,
      1.0
    );

  gl_FragColor =
    vec4(
      finalColor,
      finalAlpha
    );
}
`;

function readSpectrum(state) {
  const styles = getComputedStyle(document.documentElement);

  const get = (name) => Math.max(0, Number.parseFloat(styles.getPropertyValue(name)) || 0);

  const bands = Array.from({ length: 18 }, (_, index) => get(`--radio-band-${index}`));

  const average = (from, to) => {
    const values = bands.slice(from, to);

    if (!values.length) {
      return 0;
    }

    return values.reduce((sum, value) => sum + value, 0) / values.length;
  };

  const subBass = Math.max(get("--radio-bass"), average(0, 2));

  const bass = Math.max(get("--radio-bass"), average(1, 4));

  const lowMid = average(3, 6);

  const mid = average(5, 11);

  const highMid = average(10, 13);

  const high = average(12, 17);

  const ultraHigh = average(16, 18);

  let flux = 0;
  let total = 0;
  let weighted = 0;

  for (let index = 0; index < bands.length; index += 1) {
    const current = bands[index];

    const diff = current - state.previous[index];

    if (diff > 0) {
      flux += diff * diff;
    }

    state.previous[index] = current;

    total += current;

    weighted += current * index;
  }

  const spectralFlux = Math.sqrt(flux / bands.length);

  const spectralCentroid = total > 0 ? weighted / total / bands.length : 0;

  const currentEnergy = bass * 0.6 + subBass * 0.4;

  state.peakHistory.push(currentEnergy);

  if (state.peakHistory.length > 50) {
    state.peakHistory.shift();
  }

  const averageEnergy =
    state.peakHistory.reduce((sum, value) => sum + value, 0) /
    Math.max(1, state.peakHistory.length);

  const variance =
    state.peakHistory.reduce((sum, value) => sum + Math.pow(value - averageEnergy, 2), 0) /
    Math.max(1, state.peakHistory.length);

  const threshold = averageEnergy + Math.sqrt(variance) * 1.8;

  const now = performance.now();

  if (currentEnergy > threshold && currentEnergy > 0.08 && now - state.lastBeatTime > 120) {
    state.beatEnergy = 1;
    state.lastBeatTime = now;
  } else {
    state.beatEnergy *= 0.93;
  }

  state.onsetHistory.push(spectralFlux);

  if (state.onsetHistory.length > 8) {
    state.onsetHistory.shift();
  }

  const recent = state.onsetHistory.slice(-4).reduce((sum, value) => sum + value, 0) / 4;

  const olderValues = state.onsetHistory.slice(0, 4);

  const older =
    olderValues.reduce((sum, value) => sum + value, 0) / Math.max(1, olderValues.length);

  const onsetDetected = recent - older > 0.015;

  state.onsetEnergy = onsetDetected ? 1 : state.onsetEnergy * 0.92;

  return {
    subBass,
    bass,
    lowMid,
    mid,
    highMid,
    high,
    ultraHigh,
    spectralFlux,
    spectralCentroid,
    beatEnergy: state.beatEnergy,
    onsetEnergy: state.onsetEnergy
  };
}

function makeGeometry() {
  const geometry = new THREE.BufferGeometry();

  const positions = new Float32Array(MAX_PARTICLES * 3);

  const randoms = new Float32Array(MAX_PARTICLES * 3);

  const phases = new Float32Array(MAX_PARTICLES);

  const layers = new Float32Array(MAX_PARTICLES);

  const vector = new THREE.Vector3();

  for (let index = 0; index < MAX_PARTICLES; index += 1) {
    vector.setFromSphericalCoords(
      FIELD_RADIUS * Math.pow(Math.random(), 0.33),
      Math.acos(2 * Math.random() - 1),
      Math.random() * Math.PI * 2
    );

    const offset = index * 3;

    positions[offset] = vector.x;

    positions[offset + 1] = vector.y;

    positions[offset + 2] = vector.z;

    randoms[offset] = Math.random();

    randoms[offset + 1] = Math.random();

    randoms[offset + 2] = Math.random();

    phases[index] = Math.random() * Math.PI * 2;

    layers[index] = 0;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));

  geometry.setAttribute("aRandom", new THREE.BufferAttribute(randoms, 3));

  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));

  geometry.setAttribute("aLayer", new THREE.BufferAttribute(layers, 1));

  geometry.setDrawRange(0, Math.floor(MAX_PARTICLES * DENSITY));

  return geometry;
}

export default function AnimatedLibraryBackdrop() {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;

    if (!mount) {
      return undefined;
    }

    const scene = new THREE.Scene();

    scene.fog = new THREE.FogExp2(0x000508, 0.005);

    const camera = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      800
    );

    // Closer camera so the particle field fills the viewport.
    camera.position.set(0, 8, 118);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance"
    });

    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    renderer.setSize(window.innerWidth, window.innerHeight, false);

    renderer.setClearColor(0x000000, 0);

    renderer.toneMapping = THREE.ACESFilmicToneMapping;

    renderer.toneMappingExposure = 2.1;

    renderer.domElement.style.position = "absolute";

    renderer.domElement.style.inset = "0";

    renderer.domElement.style.width = "100%";

    renderer.domElement.style.height = "100%";

    renderer.domElement.style.display = "block";

    mount.appendChild(renderer.domElement);

    const geometry = makeGeometry();

    const material = new THREE.ShaderMaterial({
      vertexShader: VERTEX_SHADER,
      fragmentShader: FRAGMENT_SHADER,
      uniforms: {
        uTime: {
          value: 0
        },
        uPixelRatio: {
          value: Math.min(window.devicePixelRatio || 1, 2)
        },
        uSizeBase: {
          value: 2.4
        },
        uNoiseScale: {
          value: 0.4
        },
        uCurlStrength: {
          value: 0.15
        },
        uRadius: {
          value: FIELD_RADIUS
        },
        uColor1: {
          value: new THREE.Color("#ff3366")
        },
        uColor2: {
          value: new THREE.Color("#33ff99")
        },
        uColor3: {
          value: new THREE.Color("#6633ff")
        },
        uSubBass: {
          value: 0
        },
        uBass: {
          value: 0
        },
        uLowMid: {
          value: 0
        },
        uMid: {
          value: 0
        },
        uHighMid: {
          value: 0
        },
        uHigh: {
          value: 0
        },
        uUltraHigh: {
          value: 0
        },
        uBeatEnergy: {
          value: 0
        },
        uSpectralCentroid: {
          value: 0
        },
        uSpectralFlux: {
          value: 0
        },
        uOnsetEnergy: {
          value: 0
        },
        uTerrainMode: {
          value: 1
        },
        uTerrainHeight: {
          value: 20
        },
        uVortexStrength: {
          value: 0.73
        },
        uPulseIntensity: {
          value: 0.15
        },
        uZoomFactor: {
          value: 1
        },
        uBassMotion: {
          value: 0
        }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });

    const points = new THREE.Points(geometry, material);

    // Fill the whole screen: width / height / depth.
    points.scale.set(2.55, 1.9, 1.35);
    points.position.set(0, -1.5, 0);

    scene.add(points);

    const clock = new THREE.Clock();

    const audioState = {
      previous: new Float32Array(18),
      peakHistory: [],
      onsetHistory: [],
      lastBeatTime: 0,
      beatEnergy: 0,
      onsetEnergy: 0,

      // Bass-only transient detector.
      bassBaseline: 0,
      previousBassInput: 0,
      bassImpulse: 0
    };

    const smoothed = {
      subBass: 0,
      bass: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      high: 0,
      ultraHigh: 0,
      spectralFlux: 0,
      spectralCentroid: 0,
      beatEnergy: 0,
      onsetEnergy: 0
    };

    let raf = 0;

    const lerp = (current, target, factor) => THREE.MathUtils.lerp(current, target, factor);

    const resize = () => {
      const width = Math.max(1, window.innerWidth);

      const height = Math.max(1, window.innerHeight);

      camera.aspect = width / height;

      camera.updateProjectionMatrix();

      renderer.setSize(width, height, false);

      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

      material.uniforms.uPixelRatio.value = Math.min(window.devicePixelRatio || 1, 2);
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);

      const dt = clock.getDelta();
      const raw = readSpectrum(audioState);

      material.uniforms.uTime.value += dt;

      // React ONLY to a bass HIT, not to the fact that bass is continuously present.
      // We maintain a slow moving bass baseline and detect a short transient above it.
      const bassInput = Math.max(raw.subBass, raw.bass);

      // Slow baseline follows the general loudness of the bass.
      // This means a sustained bass line does NOT keep the particles expanded.
      audioState.bassBaseline = lerp(
        audioState.bassBaseline,
        bassInput,
        bassInput > audioState.bassBaseline ? 0.025 : 0.055
      );

      // Two useful hit signals:
      // 1) how far the current bass rises above its recent baseline
      // 2) how sharply the bass rose since the previous frame
      const aboveBaseline = Math.max(0, bassInput - audioState.bassBaseline);

      const bassRise = Math.max(0, bassInput - audioState.previousBassInput);

      audioState.previousBassInput = bassInput;

      // Quiet kicks get lifted, loud kicks get a larger impulse.
      const hitStrength = Math.min(
        1.6,
        Math.pow(aboveBaseline, 0.58) * 4.8 + Math.pow(bassRise, 0.54) * 6.2
      );

      // On a bass hit: jump up immediately.
      // Between hits: decay back toward ZERO, therefore back to the exact idle state.
      if (hitStrength > 0.055) {
        audioState.bassImpulse = Math.max(audioState.bassImpulse, hitStrength);
      } else {
        audioState.bassImpulse *= 0.8;
      }

      if (audioState.bassImpulse < 0.002) {
        audioState.bassImpulse = 0;
      }

      // Tiny smoothing only for visual stability.
      // Target is the transient impulse, NOT the continuous bass level.
      smoothed.bass = lerp(
        smoothed.bass,
        audioState.bassImpulse,
        audioState.bassImpulse > smoothed.bass ? 0.78 : 0.24
      );

      // Disable every old music-driven shader effect.
      // This keeps the exact same colors/idle look at all times.
      material.uniforms.uSubBass.value = 0;
      material.uniforms.uBass.value = 0;
      material.uniforms.uLowMid.value = 0;
      material.uniforms.uMid.value = 0;
      material.uniforms.uHighMid.value = 0;
      material.uniforms.uHigh.value = 0;
      material.uniforms.uUltraHigh.value = 0;
      material.uniforms.uBeatEnergy.value = 0;
      material.uniforms.uSpectralCentroid.value = 0;
      material.uniforms.uSpectralFlux.value = 0;
      material.uniforms.uOnsetEnergy.value = 0;

      // This is the ONLY music reaction now.
      // uBassMotion is a short bass-hit impulse:
      // hit -> scatter, then it decays to 0 -> exact original position.
      material.uniforms.uBassMotion.value = smoothed.bass;

      // Keep the fullscreen geometry exactly fixed.
      points.scale.set(2.55, 1.9, 1.35);
      points.position.set(0, -1.5, 0);

      // Keep only the calm idle rotation.
      points.rotation.y += dt * 0.035;

      renderer.render(scene, camera);
    };
    resize();

    window.addEventListener("resize", resize);

    animate();

    return () => {
      cancelAnimationFrame(raf);

      window.removeEventListener("resize", resize);

      scene.remove(points);

      geometry.dispose();

      material.dispose();

      renderer.dispose();

      if (renderer.domElement.parentNode === mount) {
        mount.removeChild(renderer.domElement);
      }
    };
  }, []);

  return (
    <div
      ref={mountRef}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        pointerEvents: "none"
      }}
    />
  );
}
