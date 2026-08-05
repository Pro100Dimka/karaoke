import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const KARAOKE_FILE = path.join(ROOT, "src/pages/Karaoke/index.jsx");
const source = fs.readFileSync(KARAOKE_FILE, "utf8");

test("Karaoke keeps critical media refs and one instrumental clock", () => {
  for (const refName of [
    "instrumentalRef",
    "vocalsRef",
    "videoRef",
    "melodyGuideRef"
  ]) {
    assert.match(source, new RegExp(`const ${refName} = useRef\\(`));
  }
  assert.match(
    source,
    /const position = instrumentalRef\.current\?\.currentTime/
  );
});

test("Karaoke effects retain explicit resource cleanup", () => {
  assert.match(source, /cancelAnimationFrame\(animationFrameId\)/);
  assert.match(source, /removeEventListener\("loadedmetadata"/);
  assert.match(source, /removeEventListener\("ended"/);
  assert.match(source, /observer\.disconnect\(\)/);
  assert.match(
    source,
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
    "findMatchingBrowserOutput",
    "groupBrowserAudioDevices"
  ]) {
    assert.match(source, new RegExp(`\\b${helper}\\b`));
  }
});

test("Karaoke keeps accessible button types in settings controls", () => {
  const buttonTags = source.match(/<button\b[\s\S]*?>/g) || [];
  const missingType = buttonTags.filter((tag) => !/\btype=/.test(tag));
  assert.deepEqual(missingType, []);
});
