/* eslint-disable import/no-unresolved */
import { useEffect, useRef } from "react";
import * as THREE from "three";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import {
  getQftThemeName,
  getQftThemeStyle,
  nextAdaptivePixelRatio,
  QFT_DEFAULT_SETTINGS
} from "./qft-settings";
import { createQftAudioReader } from "./qftAudio";
import { FIELD_TYPES } from "./qftConfig";
import {
  mainFragmentShader,
  mainVertexShader,
  secondaryFragmentShader,
  secondaryVertexShader
} from "./qftShaders";
import { createForceNetwork, createTrailSystem } from "./qftSystems";

function createMainGeometry(maxParticles, fieldRadius, density) {
  const geometry = new THREE.BufferGeometry();
  const positions = new Float32Array(maxParticles * 3);
  const random = new Float32Array(maxParticles * 3);
  const phases = new Float32Array(maxParticles);
  const layers = new Float32Array(maxParticles);
  const vector = new THREE.Vector3();

  for (let i = 0; i < maxParticles; i += 1) {
    vector.setFromSphericalCoords(
      fieldRadius * Math.random() ** 0.33,
      Math.acos(2 * Math.random() - 1),
      Math.random() * Math.PI * 2
    );
    const o = i * 3;
    positions[o] = vector.x;
    positions[o + 1] = vector.y;
    positions[o + 2] = vector.z;
    random[o] = Math.random();
    random[o + 1] = Math.random();
    random[o + 2] = Math.random();
    phases[i] = Math.random() * Math.PI * 2;
    layers[i] = 0;
  }

  geometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geometry.setAttribute("aRandom", new THREE.BufferAttribute(random, 3));
  geometry.setAttribute("aPhase", new THREE.BufferAttribute(phases, 1));
  geometry.setAttribute("aLayer", new THREE.BufferAttribute(layers, 1));
  geometry.setDrawRange(0, Math.floor(maxParticles * Math.max(0.001, Math.min(1, density))));
  return geometry;
}

function createSecondaryGeometry(count, fieldRadius) {
  const geometry = new THREE.InstancedBufferGeometry();
  geometry.setAttribute("position", new THREE.BufferAttribute(new Float32Array([0, 0, 0]), 3));
  const positions = new Float32Array(count * 3);
  const random = new Float32Array(count * 3);
  const phases = new Float32Array(count);

  for (let i = 0; i < count; i += 1) {
    const r = fieldRadius * (0.65 + Math.random() * 0.45);
    const theta = Math.acos(2 * Math.random() - 1);
    const phi = Math.random() * Math.PI * 2;
    const o = i * 3;
    positions[o] = r * Math.sin(theta) * Math.cos(phi);
    positions[o + 1] = r * Math.sin(theta) * Math.sin(phi);
    positions[o + 2] = r * Math.cos(theta);
    random[o] = Math.random();
    random[o + 1] = Math.random();
    random[o + 2] = Math.random();
    phases[i] = Math.random() * Math.PI * 2;
  }

  geometry.setAttribute("instancePosition", new THREE.InstancedBufferAttribute(positions, 3));
  geometry.setAttribute("instanceRandom", new THREE.InstancedBufferAttribute(random, 3));
  geometry.setAttribute("instancePhase", new THREE.InstancedBufferAttribute(phases, 1));
  geometry.instanceCount = count;
  return geometry;
}

function makeUniforms(field, theme, pixelRatio, settings) {
  return {
    uTime: { value: 0 },
    uPixelRatio: { value: pixelRatio },
    uSizeBase: { value: field.sz },
    uNoiseScale: { value: field.s },
    uCurlStrength: { value: field.curl },
    uRadius: { value: settings.fieldRadius },
    uColor1: { value: new THREE.Color(theme.particle1) },
    uColor2: { value: new THREE.Color(theme.particle2) },
    uColor3: { value: new THREE.Color(theme.particle3) },
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
    uTerrainMode: { value: field.terrain ? 1 : 0 },
    uTerrainHeight: { value: settings.terrainHeight },
    uVortexStrength: { value: settings.vortex },
    uPulseIntensity: { value: settings.pulseIntensity },
    uZoomFactor: { value: 1 },
    uMousePos: { value: new THREE.Vector3() },
    uMouseVelocity: { value: new THREE.Vector2() }
  };
}

function createFlareTexture(color) {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const ctx = canvas.getContext("2d");
  const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
  gradient.addColorStop(0, "rgba(255,255,255,1)");
  gradient.addColorStop(0.08, color);
  gradient.addColorStop(0.28, "rgba(255,255,255,.22)");
  gradient.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = gradient;
  ctx.fillRect(0, 0, 256, 256);
  return new THREE.CanvasTexture(canvas);
}

const POST_SHADER = {
  uniforms: {
    tDiffuse: { value: null },
    uTime: { value: 0 },
    uChromatic: { value: 0 },
    uAnamorphic: { value: 0 },
    uGodRays: { value: 0 },
    uGodRaysIntensity: { value: 0 },
    uFilmGrain: { value: 0 },
    uDof: { value: 0 },
    uFocusRing: { value: 0.02 },
    uFocusFalloff: { value: 0.4 },
    uBlurAmount: { value: 0.36 }
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
    uniform float uTime;
    uniform float uChromatic;
    uniform float uAnamorphic;
    uniform float uGodRays;
    uniform float uGodRaysIntensity;
    uniform float uFilmGrain;
    uniform float uDof;
    uniform float uFocusRing;
    uniform float uFocusFalloff;
    uniform float uBlurAmount;
    varying vec2 vUv;

    float rand(vec2 co) {
      return fract(sin(dot(co, vec2(12.9898, 78.233)) + uTime) * 43758.5453);
    }

    void main() {
      vec2 centre = vec2(0.5);
      vec2 dir = normalize(vUv - centre + vec2(0.0001));
      float ca = uChromatic * 1.8;
      vec3 color;
      color.r = texture2D(tDiffuse, vUv + dir * ca).r;
      color.g = texture2D(tDiffuse, vUv).g;
      color.b = texture2D(tDiffuse, vUv - dir * ca).b;

      if (uDof > 0.5) {
        float d = abs(length(vUv - centre) - uFocusRing);
        float blur = smoothstep(max(0.001, uFocusFalloff * 0.12), max(0.002, uFocusFalloff * 0.45), d) * uBlurAmount * 0.008;
        vec3 b = color;
        b += texture2D(tDiffuse, vUv + vec2( blur, 0.0)).rgb;
        b += texture2D(tDiffuse, vUv + vec2(-blur, 0.0)).rgb;
        b += texture2D(tDiffuse, vUv + vec2(0.0,  blur)).rgb;
        b += texture2D(tDiffuse, vUv + vec2(0.0, -blur)).rgb;
        color = mix(color, b / 5.0, clamp(uBlurAmount, 0.0, 1.0));
      }

      if (uAnamorphic > 0.0) {
        vec3 streak = texture2D(tDiffuse, vUv + vec2(0.006, 0.0)).rgb;
        streak += texture2D(tDiffuse, vUv - vec2(0.006, 0.0)).rgb;
        color += max(streak - 1.0, 0.0) * uAnamorphic;
      }

      if (uGodRays > 0.5) {
        vec2 stepUv = (centre - vUv) * 0.035;
        vec2 uv = vUv;
        vec3 rays = vec3(0.0);
        for (int i = 0; i < 8; i++) {
          uv += stepUv;
          rays += texture2D(tDiffuse, uv).rgb;
        }
        color += rays * (uGodRaysIntensity / 8.0);
      }

      color += (rand(vUv) - 0.5) * uFilmGrain;
      gl_FragColor = vec4(color, 1.0);
    }
  `
};

// A fresh `{}` as the default parameter value would be a new object identity
// on every render, and it's a direct dependency of the effect below that
// builds the whole WebGL scene/renderer/composer -- so any parent re-render
// (Library polls songs/status frequently) would tear down and rebuild the
// entire visualizer instead of just leaving it running. A frozen module-level
// constant keeps the identity stable across renders when no settings prop is
// passed (its only caller today never passes one).
const EMPTY_SETTINGS = Object.freeze({});

export default function QuantumFieldBackdrop({
  settings: overrides = EMPTY_SETTINGS,
  fieldType,
  sensitivity,
  density,
  scale,
  position,
  camera,
  terrainHeight,
  secondary,
  trails,
  connections,
  bloom,
  afterimage,
  className,
  style
}) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const settings = {
      ...QFT_DEFAULT_SETTINGS,
      ...overrides,
      ...(fieldType !== undefined ? { fieldType } : {}),
      ...(sensitivity !== undefined ? { sensitivity } : {}),
      ...(density !== undefined ? { density } : {}),
      ...(scale !== undefined ? { scale } : {}),
      ...(position !== undefined ? { position } : {}),
      ...(camera !== undefined ? { camera } : {}),
      ...(terrainHeight !== undefined ? { terrainHeight } : {}),
      ...(secondary !== undefined ? { secondaryParticlesEnabled: secondary } : {}),
      ...(trails !== undefined ? { particleTrails: trails } : {}),
      ...(connections !== undefined ? { forceNetwork: connections } : {}),
      ...(bloom !== undefined ? { bloom } : {}),
      ...(afterimage !== undefined ? { motionBlur: afterimage } : {})
    };

    const field = FIELD_TYPES[settings.fieldType] || FIELD_TYPES["Waveform Terrain"];
    let themeName = getQftThemeName();
    let theme = getQftThemeStyle(themeName);
    let pixelRatio = Math.min(window.devicePixelRatio || 1, settings.pixelRatioMax);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(new THREE.Color(theme.fog), 0.005);

    const camera3d = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      800
    );
    camera3d.position.set(...settings.camera);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = settings.exposure;
    Object.assign(renderer.domElement.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block"
    });
    mount.appendChild(renderer.domElement);

    const geometry = createMainGeometry(
      settings.maxParticles,
      settings.fieldRadius,
      settings.density
    );
    const material = new THREE.ShaderMaterial({
      vertexShader: mainVertexShader,
      fragmentShader: mainFragmentShader,
      uniforms: makeUniforms(field, theme, pixelRatio, settings),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(geometry, material);
    points.scale.set(...settings.scale);
    points.position.set(...settings.position);
    scene.add(points);

    const secondaryGeometry = createSecondaryGeometry(
      settings.secondaryParticles,
      settings.fieldRadius
    );
    const secondaryMaterial = new THREE.ShaderMaterial({
      vertexShader: secondaryVertexShader,
      fragmentShader: secondaryFragmentShader,
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: pixelRatio },
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
        uVortexStrength: { value: settings.vortex },
        uColor1: { value: new THREE.Color(theme.secondary1) },
        uColor2: { value: new THREE.Color(theme.secondary2) },
        uRadius: { value: settings.fieldRadius }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const secondaryPoints = new THREE.Points(secondaryGeometry, secondaryMaterial);
    secondaryPoints.visible = settings.secondaryParticlesEnabled;
    secondaryPoints.scale.copy(points.scale);
    secondaryPoints.position.copy(points.position);
    scene.add(secondaryPoints);

    const trailSystem = createTrailSystem(scene, { color: theme.trail });
    const network = createForceNetwork(scene, geometry, {
      fieldRadius: settings.fieldRadius,
      color1: theme.network1,
      color2: theme.network2
    });

    const flareTexture = createFlareTexture(theme.flare);
    const flareMaterial = new THREE.SpriteMaterial({
      map: flareTexture,
      color: new THREE.Color(theme.flare),
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      opacity: settings.flareIntensity
    });
    const flare = new THREE.Sprite(flareMaterial);
    flare.position.set(-22, 18, 6);
    flare.scale.set(34, 34, 1);
    flare.visible = false;

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera3d));

    const afterimagePass = new AfterimagePass();
    afterimagePass.uniforms.damp.value = settings.motionBlur;
    composer.addPass(afterimagePass);

    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      settings.bloom,
      0.4,
      0.85
    );
    bloomPass.threshold = 0.85;
    bloomPass.strength = settings.bloom;
    bloomPass.radius = 0.4;
    composer.addPass(bloomPass);

    const postPass = new ShaderPass(POST_SHADER);
    postPass.uniforms.uChromatic.value = settings.chromaticAberration;
    postPass.uniforms.uAnamorphic.value = settings.anamorphicStretch;
    postPass.uniforms.uGodRays.value = settings.godRays ? 1 : 0;
    postPass.uniforms.uGodRaysIntensity.value = settings.godRaysIntensity;
    postPass.uniforms.uFilmGrain.value = settings.filmGrain;
    postPass.uniforms.uDof.value = settings.depthOfField ? 1 : 0;
    postPass.uniforms.uFocusRing.value = settings.focusRing;
    postPass.uniforms.uFocusFalloff.value = settings.focusFalloff;
    postPass.uniforms.uBlurAmount.value = settings.blurAmount;
    composer.addPass(postPass);
    composer.addPass(new OutputPass());

    const readAudio = createQftAudioReader({
      bassGateEnabled: settings.bassGateEnabled,
      bassGateThreshold: settings.bassGateThreshold,
      bassGateAttack: settings.bassGateAttack,
      bassGateRelease: settings.bassGateRelease,
      bassGateRatio: settings.bassGateRatio,
      onsetSensitivity: settings.onsetSensitivity
    });

    const clock = new THREE.Clock();
    let raf = 0;
    let frames = 0;
    let fpsTimer = performance.now();

    const updateTheme = () => {
      const nextName = getQftThemeName();
      if (nextName === themeName) return;
      themeName = nextName;
      theme = getQftThemeStyle(themeName);
      scene.fog.color.set(theme.fog);
      material.uniforms.uColor1.value.set(theme.particle1);
      material.uniforms.uColor2.value.set(theme.particle2);
      material.uniforms.uColor3.value.set(theme.particle3);
      secondaryMaterial.uniforms.uColor1.value.set(theme.secondary1);
      secondaryMaterial.uniforms.uColor2.value.set(theme.secondary2);
      flareMaterial.color.set(theme.flare);
      trailSystem.setColor(theme.trail);
      network.setColors(theme.network1, theme.network2);
    };

    const updateUniforms = (audio) => {
      const lf = 0.16;
      const pairs = [
        ["uSubBass", "subBass"],
        ["uBass", "bass"],
        ["uLowMid", "lowMid"],
        ["uMid", "mid"],
        ["uHighMid", "highMid"],
        ["uHigh", "high"],
        ["uUltraHigh", "ultraHigh"]
      ];
      for (const [uniform, band] of pairs) {
        material.uniforms[uniform].value = THREE.MathUtils.lerp(
          material.uniforms[uniform].value,
          audio.gatedBands[band] * settings.sensitivity,
          lf
        );
      }
      material.uniforms.uBeatEnergy.value = THREE.MathUtils.lerp(
        material.uniforms.uBeatEnergy.value,
        audio.beatEnergy,
        0.22
      );
      material.uniforms.uSpectralCentroid.value = THREE.MathUtils.lerp(
        material.uniforms.uSpectralCentroid.value,
        audio.spectralCentroid,
        lf
      );
      material.uniforms.uSpectralFlux.value = THREE.MathUtils.lerp(
        material.uniforms.uSpectralFlux.value,
        audio.spectralFlux * settings.sensitivity,
        lf
      );
      material.uniforms.uOnsetEnergy.value = settings.onsetPunch
        ? THREE.MathUtils.lerp(material.uniforms.uOnsetEnergy.value, audio.onsetEnergy, 0.25)
        : 0;

      for (const key of [
        "uSubBass",
        "uBass",
        "uLowMid",
        "uMid",
        "uHighMid",
        "uHigh",
        "uUltraHigh",
        "uBeatEnergy",
        "uSpectralCentroid",
        "uSpectralFlux",
        "uOnsetEnergy"
      ]) {
        secondaryMaterial.uniforms[key].value = material.uniforms[key].value;
      }
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);

      const dt = clock.getDelta();
      const elapsed = clock.getElapsedTime();
      const audio = readAudio();
      material.uniforms.uTime.value += dt * settings.timeFlow;
      material.uniforms.uZoomFactor.value = camera3d.position.length() / 118;
      material.uniforms.uVortexStrength.value = settings.vortex;
      material.uniforms.uPulseIntensity.value = settings.pulseIntensity;
      material.uniforms.uTerrainHeight.value = settings.terrainHeight;
      secondaryMaterial.uniforms.uTime.value = material.uniforms.uTime.value;
      secondaryMaterial.uniforms.uVortexStrength.value = settings.vortex;
      updateUniforms(audio);

      const live = {
        bass: material.uniforms.uBass.value,
        mid: material.uniforms.uMid.value,
        high: material.uniforms.uHigh.value,
        highMid: material.uniforms.uHighMid.value,
        beat: material.uniforms.uBeatEnergy.value,
        centroid: material.uniforms.uSpectralCentroid.value
      };

      secondaryPoints.visible = settings.secondaryParticlesEnabled;
      trailSystem.update(elapsed, live, settings.particleTrails, settings.trailOpacity);
      network.update({
        threshold: settings.networkRange,
        bass: live.bass,
        highMid: live.highMid,
        mid: live.mid,
        beat: live.beat,
        centroid: live.centroid,
        opacity:
          settings.networkOpacity *
          (settings.networkCrawlers ? 0.72 + Math.sin(elapsed * 2.2) * 0.28 : 1),
        enabled: settings.forceNetwork
      });

      points.rotation.y +=
        dt * settings.timeFlow * (settings.idleRotationSpeed + live.mid * 2 + live.beat * 2);
      secondaryPoints.rotation.y = points.rotation.y * 0.75;

      if (settings.audioCamera) {
        const shake =
          settings.cameraShake * settings.audioCameraIntensity * (live.bass + live.beat);
        camera3d.position.x = settings.camera[0] + Math.sin(elapsed * 23) * shake;
        camera3d.position.y = settings.camera[1] + Math.cos(elapsed * 19) * shake;
        camera3d.position.z = settings.camera[2] + Math.sin(elapsed * 13) * shake * 0.4;
      }

      flare.visible = false;
      flareMaterial.opacity = 0;
      flare.scale.setScalar(28 + settings.flareIntensity * 14 + live.beat * 8);

      bloomPass.strength =
        settings.bloom + (audio.gatedBands.bass + audio.gatedBands.mid + audio.beatEnergy) / 6;
      afterimagePass.uniforms.damp.value = settings.motionBlur;
      postPass.uniforms.uTime.value = elapsed;

      // Every frame builds up bloomPass/afterimagePass/postPass state (bloom,
      // motion blur, chromatic aberration, god rays, film grain, depth of
      // field...) into the composer, so it must actually be the thing that
      // renders -- calling renderer.render() directly here skipped the whole
      // pipeline, silently disabling every one of those effects despite
      // their settings and per-frame updates still running.
      composer.render();

      if (settings.adaptiveQuality) {
        frames += 1;
        const now = performance.now();
        if (now - fpsTimer >= 1000) {
          const fps = (frames * 1000) / (now - fpsTimer);
          frames = 0;
          fpsTimer = now;
          pixelRatio = nextAdaptivePixelRatio(pixelRatio, fps, {
            targetFPS: settings.targetFPS,
            pixelRatioMax: settings.pixelRatioMax
          });
          renderer.setPixelRatio(pixelRatio);
        }
      }
    };

    const resize = () => {
      const width = Math.max(1, window.innerWidth);
      const height = Math.max(1, window.innerHeight);
      camera3d.aspect = width / height;
      camera3d.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      composer.setSize(width, height);
    };

    window.addEventListener("resize", resize);
    // The theme (light/dark) only ever changes when the user toggles it, but
    // updateTheme() used to run inside the rAF loop, crossing into the DOM to
    // read documentElement's data-theme attribute up to 60 times a second
    // just to catch that rare change. A MutationObserver reacts to the
    // attribute actually changing instead, so this scene's per-frame work no
    // longer touches the DOM/CSSOM at all.
    const themeObserver = new MutationObserver(updateTheme);
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"]
    });
    animate();

    return () => {
      cancelAnimationFrame(raf);
      themeObserver.disconnect();
      window.removeEventListener("resize", resize);
      trailSystem.dispose();
      network.dispose();
      scene.remove(points, secondaryPoints, flare);
      flareTexture.dispose();
      flareMaterial.dispose();
      geometry.dispose();
      secondaryGeometry.dispose();
      material.dispose();
      secondaryMaterial.dispose();
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
  }, [
    afterimage,
    bloom,
    camera,
    connections,
    density,
    fieldType,
    overrides,
    position,
    scale,
    secondary,
    sensitivity,
    terrainHeight,
    trails
  ]);

  const s = { ...QFT_DEFAULT_SETTINGS, ...overrides };
  const nebula = Math.max(0, Math.min(1, s.nebulaIntensity));
  const dim = Math.max(0, Math.min(1, s.backgroundDim));

  return (
    <div
      ref={mountRef}
      className={className}
      aria-hidden="true"
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        overflow: "hidden",
        pointerEvents: "none",
        background: "transparent",
        backdropFilter: "none",
        WebkitBackdropFilter: "none",
        ...style
      }}
    />
  );
}
