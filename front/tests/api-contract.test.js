import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const domainDir = path.join(root, "src/api/domains");
const EXPECTED_METHODS = [
  "addSong",
  "cancelProcessing",
  "clearCache",
  "deleteModel",
  "deleteRecording",
  "deleteSong",
  "deleteTemp",
  "downloadModel",
  "exportSongPackage",
  "getAbout",
  "getAnalysis",
  "getAppSettings",
  "getAudioSettings",
  "getAudioTrackUrl",
  "getCacheSize",
  "getErrors",
  "getFreeSpace",
  "getHealth",
  "getHistory",
  "getLog",
  "getPerformanceFileUrl",
  "getPipelineHealth",
  "getPosition",
  "getRecordingFileUrl",
  "getRecordingSettings",
  "getResult",
  "getSignalQuality",
  "getSong",
  "getStatus",
  "getSync",
  "getTimeline",
  "getVersions",
  "importSongPackage",
  "listAsioDrivers",
  "listAudioDevices",
  "listAudioOutputDevices",
  "listRecordingLibrary",
  "listRecordingsForSong",
  "listSongs",
  "listWhisperModels",
  "optimizeSong",
  "pause",
  "pauseRecording",
  "play",
  "processSong",
  "releaseDirectMonitoring",
  "reprocessMelody",
  "resumeRecording",
  "runAnalysis",
  "seek",
  "selectModel",
  "startDirectMonitoring",
  "startRecording",
  "stop",
  "stopDirectMonitoring",
  "stopRecording",
  "updateAppSettings",
  "updateAudioSettings",
  "updateLyrics",
  "updateSong"
].sort();

function extractDomainMethods() {
  return fs
    .readdirSync(domainDir)
    .filter((name) => name.endsWith(".js"))
    .flatMap((name) => {
      const source = fs.readFileSync(path.join(domainDir, name), "utf8");
      return [...source.matchAll(/^\s{2}([A-Za-z_$][\w$]*):/gm)].map(
        (match) => match[1]
      );
    })
    .sort();
}

test("domain API keeps the complete legacy method contract", () => {
  assert.deepEqual(extractDomainMethods(), EXPECTED_METHODS);
  const client = fs.readFileSync(path.join(root, "src/api/client.js"), "utf8");
  assert.match(client, /Object\.freeze\s*\(/);
});
