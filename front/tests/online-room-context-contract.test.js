import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (file) => fs.readFileSync(path.join(root, file), "utf8");
const context = read("src/contexts/OnlineRoomContext.jsx");
const speakingLevels = read("src/contexts/hooks/useSpeakingLevels.js");
const applicationAudio = read(
  "src/contexts/hooks/useApplicationAudioMute.js"
);

test("OnlineRoom delegates speaking level analysis to a dedicated hook", () => {
  assert.match(context, /useSpeakingLevels\(\)/);
  assert.doesNotMatch(context, /createMediaStreamSource/);
  assert.doesNotMatch(context, /getByteTimeDomainData/);
});

test("speaking level hook cleans intervals, nodes and AudioContext", () => {
  assert.match(speakingLevels, /window\.clearInterval/);
  assert.match(speakingLevels, /disconnectNode\(meter\.source\)/);
  assert.match(speakingLevels, /disconnectNode\(meter\.analyser\)/);
  assert.match(speakingLevels, /audioContextRef\.current\?\.close\(\)/);
});

test("room audio muting preserves and restores original audio state", () => {
  assert.match(applicationAudio, /originalMuteStateRef\.current\.set/);
  assert.match(applicationAudio, /audio\.muted = wasMuted/);
  assert.match(applicationAudio, /originalMuteStateRef\.current\.clear\(\)/);
});

test("room audio observer is disconnected", () => {
  assert.match(applicationAudio, /new MutationObserver/);
  assert.match(applicationAudio, /observer\.disconnect\(\)/);
});

const roomMessages = read("src/contexts/onlineRoomMessages.js");

test("OnlineRoom delegates server message routing to a dedicated module", () => {
  assert.match(context, /createOnlineRoomMessageHandler\(/);
  assert.doesNotMatch(context, /message\.type === "participant-joined"/);
  assert.match(roomMessages, /message\.type === "participant-joined"/);
});

test("microphone mute decisions use the latest synchronous ref", () => {
  assert.match(context, /const microphoneMutedRef = useRef\(false\)/);
  assert.match(context, /microphoneMutedRef\.current = next/);
  assert.match(
    context,
    /previousMicMutedRef\.current = microphoneMutedRef\.current/
  );
});

test("incoming files tolerate missing metadata", () => {
  assert.match(context, /metadata\?\.kind !== "song-package"/);
});

test("voice invitations require a participant id", () => {
  assert.match(roomMessages, /if \(message\.participant\?\.id\)/);
  assert.match(roomMessages, /voice\.invite\(message\.participant\.id\)/);
});

test("room connections ignore stale asynchronous completions", () => {
  assert.match(context, /const connectionVersionRef = useRef\(0\)/);
  assert.match(
    context,
    /if \(connectionVersion !== connectionVersionRef\.current\)/
  );
  assert.match(context, /connectionVersionRef\.current \+= 1/);
});

test("stale voice callbacks cannot mutate the active room", () => {
  assert.match(context, /const isCurrentConnection = \(\) =>/);
  assert.match(context, /if \(!isCurrentConnection\(\)\) \{/);
  assert.match(context, /stream\.getTracks\(\)\.forEach\(\(track\) => track\.stop\(\)\)/);
  assert.match(context, /if \(isCurrentConnection\(\)\) removeRemoteAudio\(participantId\)/);
  assert.match(context, /if \(!isCurrentConnection\(\)\) return;\n\s+const pendingCommand/);
});

test("stale microphone startup errors are ignored", () => {
  assert.match(
    context,
    /\.catch\(\(error\) => \{\n\s+if \(!isCurrentConnection\(\)\) return;/
  );
});

test("message handler receives the active connection guard", () => {
  assert.match(
    context,
    /createOnlineRoomMessageHandler\(\{[\s\S]*?isCurrentConnection,[\s\S]*?setVoiceError[\s\S]*?\}\)\n\s*\);/
  );
});

test("manual microphone requests ignore a replaced voice connection", () => {
  assert.match(context, /if \(voiceRef\.current !== voice\) \{/);
  assert.match(context, /if \(voiceRef\.current !== voice\) return false;/);
});
