import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KARAOKE_FILE = path.join(ROOT, "src/pages/Karaoke/index.jsx");
const KARAOKE_HOOKS_DIR = path.join(ROOT, "src/pages/Karaoke/hooks");
const source = fs.readFileSync(KARAOKE_FILE, "utf8");
const infrastructureSource = [
  "useKaraokePanorama.js",
  "useKaraokeStageLayout.js",
  "useMelodyGuide.js",
  "useMicrophoneSettings.js",
  "useAudioOutputRouting.js",
  "usePitchDetection.js",
  "useKaraokeMediaSync.js",
  "useKaraokeTransport.js"
]
  .map((file) => fs.readFileSync(path.join(KARAOKE_HOOKS_DIR, file), "utf8"))
  .join("\n");

test("Karaoke keeps critical media refs and one instrumental clock", () => {
  for (const refName of ["instrumentalRef", "vocalsRef", "videoRef"]) {
    assert.match(source, new RegExp(`const ${refName} = useRef\\(`));
  }
  assert.match(infrastructureSource, /const guideRef = useRef\(/);
  assert.match(
    infrastructureSource,
    /const position = instrumentalRef\.current\?\.currentTime/
  );
});

test("Karaoke effects retain explicit resource cleanup", () => {
  assert.match(
    infrastructureSource,
    /cancelAnimationFrame\(animationFrameId\)/
  );
  assert.match(infrastructureSource, /removeEventListener\("loadedmetadata"/);
  assert.match(infrastructureSource, /removeEventListener\("ended"/);
  assert.match(infrastructureSource, /observer\.disconnect\(\)/);
  assert.match(
    infrastructureSource,
    /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/
  );
});

test("Karaoke does not directly parse or persist preferences", () => {
  assert.doesNotMatch(source, /JSON\.parse\(/);
  assert.doesNotMatch(source, /localStorage\.(?:getItem|setItem)/);
  assert.match(source, /useKaraokePreferences/);
  assert.doesNotMatch(source, /loadKaraokePreferences/);
  assert.doesNotMatch(source, /saveKaraokePreferences/);
});

test("Karaoke uses extracted deterministic helpers", () => {
  for (const helper of [
    "getPanoramaPosition",
    "getKaraokeStageLayout",
    "getMelodyGuideState",
    "findPreferredOutputDevice",
    "findMatchingBrowserOutput"
  ]) {
    assert.match(
      `${source}\n${infrastructureSource}`,
      new RegExp(`\\b${helper}\\b`)
    );
  }
});

test("Karaoke keeps accessible button types in settings controls", () => {
  const buttonTags = source.match(/<button\b[\s\S]*?>/g) || [];
  const missingType = buttonTags.filter((tag) => !/\btype=/.test(tag));
  assert.deepEqual(missingType, []);
});

test("Karaoke delegates media synchronization to a dedicated hook", () => {
  assert.match(source, /useKaraokeMediaSync\(\{/);
  assert.match(infrastructureSource, /syncSecondaryMedia/);
  assert.match(infrastructureSource, /sendYouTubeCommand/);
});

test("Karaoke declares current tempo exactly once", () => {
  const declarations = source.match(/const currentTempo\b/g) || [];
  assert.equal(declarations.length, 1);
});
