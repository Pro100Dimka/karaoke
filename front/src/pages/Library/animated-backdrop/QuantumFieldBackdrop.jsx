import { useEffect, useRef } from "react";
import * as THREE from "three";
import { AfterimagePass } from "three/addons/postprocessing/AfterimagePass.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";

import { createQftAudioReader } from "./qftAudio";
import { DEFAULTS, FIELD_TYPES } from "./qftConfig";
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
  geometry.setDrawRange(0, Math.floor(maxParticles * density));
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

const makeUniforms = (field, pixelRatio, fieldRadius, terrainHeight) => ({
  uTime: { value: 0 },
  uPixelRatio: { value: pixelRatio },
  uSizeBase: { value: field.sz },
  uNoiseScale: { value: field.s },
  uCurlStrength: { value: field.curl },
  uRadius: { value: fieldRadius },
  uColor1: { value: new THREE.Color(field.c1) },
  uColor2: { value: new THREE.Color(field.c2) },
  uColor3: { value: new THREE.Color(field.c3) },
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
  uTerrainHeight: { value: terrainHeight },
  uVortexStrength: { value: DEFAULTS.vortexStrength },
  uPulseIntensity: { value: DEFAULTS.pulseIntensity },
  uZoomFactor: { value: 1 },
  uMousePos: { value: new THREE.Vector3() },
  uMouseVelocity: { value: new THREE.Vector2() }
});

export default function QuantumFieldBackdrop({
  fieldType = "Neutrino",
  sensitivity = DEFAULTS.sensitivity,
  density = DEFAULTS.density,
  scale = [2.55, 1.9, 1.35],
  position = [0, -1.5, 0],
  camera = [0, 8, 118],
  terrainHeight = DEFAULTS.terrainHeight,
  secondary = true,
  trails = true,
  connections = true,
  bloom = DEFAULTS.bloom,
  afterimage = DEFAULTS.trails,
  className,
  style
}) {
  const mountRef = useRef(null);

  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return undefined;

    const field = FIELD_TYPES[fieldType] || FIELD_TYPES.Neutrino;
    const pixelRatio = Math.min(window.devicePixelRatio || 1, 1.5);
    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x000508, 0.005);

    const camera3d = new THREE.PerspectiveCamera(
      55,
      window.innerWidth / window.innerHeight,
      0.1,
      800
    );
    camera3d.position.set(...camera);

    const renderer = new THREE.WebGLRenderer({
      alpha: true,
      antialias: true,
      powerPreference: "high-performance"
    });
    renderer.setPixelRatio(pixelRatio);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
    renderer.setClearColor(0x000000, 0);
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 2.1;
    Object.assign(renderer.domElement.style, {
      position: "absolute",
      inset: "0",
      width: "100%",
      height: "100%",
      display: "block"
    });
    mount.appendChild(renderer.domElement);

    const geometry = createMainGeometry(DEFAULTS.maxParticles, DEFAULTS.fieldRadius, density);
    const material = new THREE.ShaderMaterial({
      vertexShader: mainVertexShader,
      fragmentShader: mainFragmentShader,
      uniforms: makeUniforms(field, pixelRatio, DEFAULTS.fieldRadius, terrainHeight),
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const points = new THREE.Points(geometry, material);
    points.scale.set(...scale);
    points.position.set(...position);
    scene.add(points);

    const secondaryGeometry = createSecondaryGeometry(
      DEFAULTS.secondaryParticles,
      DEFAULTS.fieldRadius
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
        uVortexStrength: { value: DEFAULTS.vortexStrength },
        uColor1: { value: new THREE.Color(field.sc1) },
        uColor2: { value: new THREE.Color(field.sc2) },
        uRadius: { value: DEFAULTS.fieldRadius }
      },
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending
    });
    const secondaryPoints = new THREE.Points(secondaryGeometry, secondaryMaterial);
    secondaryPoints.visible = secondary;
    secondaryPoints.scale.copy(points.scale);
    secondaryPoints.position.copy(points.position);
    scene.add(secondaryPoints);

    const trailSystem = createTrailSystem(scene, { color: field.c1 });
    const network = createForceNetwork(scene, geometry, {
      fieldRadius: DEFAULTS.fieldRadius,
      color1: field.c2,
      color2: field.c1
    });

    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera3d));
    const afterimagePass = new AfterimagePass();
    afterimagePass.uniforms.damp.value = afterimage;
    composer.addPass(afterimagePass);
    const bloomPass = new UnrealBloomPass(
      new THREE.Vector2(window.innerWidth, window.innerHeight),
      1.5,
      0.4,
      0.85
    );
    bloomPass.threshold = 0.85;
    bloomPass.strength = bloom;
    bloomPass.radius = 0.4;
    composer.addPass(bloomPass);
    composer.addPass(new OutputPass());

    const readAudio = createQftAudioReader();
    const clock = new THREE.Clock();
    let raf = 0;

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
          audio.gatedBands[band] * sensitivity,
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
        audio.spectralFlux * sensitivity,
        lf
      );
      material.uniforms.uOnsetEnergy.value = THREE.MathUtils.lerp(
        material.uniforms.uOnsetEnergy.value,
        audio.onsetEnergy,
        0.25
      );

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
      material.uniforms.uTime.value += dt;
      material.uniforms.uZoomFactor.value = camera3d.position.length() / 118;
      updateUniforms(audio);
      secondaryMaterial.uniforms.uTime.value = material.uniforms.uTime.value;
      secondaryPoints.visible = secondary;

      const live = {
        bass: material.uniforms.uBass.value,
        mid: material.uniforms.uMid.value,
        high: material.uniforms.uHigh.value,
        highMid: material.uniforms.uHighMid.value,
        beat: material.uniforms.uBeatEnergy.value,
        centroid: material.uniforms.uSpectralCentroid.value
      };
      trailSystem.update(elapsed, live, trails && audio.active);
      network.update({
        threshold: DEFAULTS.connectionThreshold,
        bass: live.bass,
        highMid: live.highMid,
        mid: live.mid,
        beat: live.beat,
        centroid: live.centroid,
        opacity: DEFAULTS.connectionOpacity,
        enabled: connections && audio.active
      });

      points.rotation.y += dt * (0.035 + live.mid * 2 + live.beat * 2);
      secondaryPoints.rotation.y = points.rotation.y * 0.75;
      bloomPass.strength =
        bloom + (audio.gatedBands.bass + audio.gatedBands.mid + audio.beatEnergy) / 6;
      composer.render();
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
    animate();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      trailSystem.dispose();
      network.dispose();
      scene.remove(points, secondaryPoints);
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
    position,
    scale,
    secondary,
    sensitivity,
    terrainHeight,
    trails
  ]);

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
        ...style
      }}
    />
  );
}
