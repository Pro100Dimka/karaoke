import { translateSaved } from "../i18n/runtime";
import { isValidSongRevision } from "../services/onlineRoom";
import { getErrorMessage } from "../utils/errors";

export function createCommandId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const SONG_READY_TIMEOUT_MS = 5 * 60_000;

export async function openKaraokeInRoom({
  songId,
  ownerId,
  revision: suppliedRevision,
  room,
  client,
  roomApi,
  isCurrentConnection,
  hostSongCommandRef,
  onTransferStatus,
  participantsRef,
  voice
}) {
  if (!isCurrentConnection()) return true;
  const revisionPayload = suppliedRevision ? null : await roomApi?.getSongRevision?.(songId);
  const revision = suppliedRevision || revisionPayload?.revision;
  if (!isValidSongRevision(revision))
    throw new Error(translateSaved("room.couldNotDetermineTheSongContentVersion"));
  if (!isCurrentConnection()) return false;

  if (room && !room.host) {
    client?.send("sync", {
      state: {
        type: "karaoke-request",
        songId,
        commandId: createCommandId(),
        revision,
        ownerId: ownerId || room.selfId,
        requesterId: room.selfId
      }
    });
    return false;
  }

  const command = { type: "open-karaoke", songId, commandId: createCommandId(), revision };
  const publishTransferStatus = (stage, percent, error) => {
    if (!room) return;
    const status = {
      participantId: "room",
      songId,
      commandId: command.commandId,
      stage,
      percent,
      ...(error ? { error } : {})
    };
    onTransferStatus?.(status);
    client?.send("sync", { state: { type: "song-transfer-status", ...status } });
  };
  const previousCommandId = hostSongCommandRef?.current?.commandId;
  if (previousCommandId && previousCommandId !== command.commandId)
    voice?.cancelTransfersByCommandId?.(previousCommandId);

  const expectedIds = new Set(
    (participantsRef?.current || [])
      .filter((participant) => participant?.id && participant.id !== room?.selfId)
      .map((participant) => participant.id)
  );
  let resolveReady;
  let rejectReady;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReady = reject;
  });
  const timer = globalThis.setTimeout(
    () =>
      rejectReady(
        new Error(translateSaved("room.songTransferStoppedTheParticipantIsNotResponding"))
      ),
    SONG_READY_TIMEOUT_MS
  );
  if (hostSongCommandRef) {
    hostSongCommandRef.current = {
      ...command,
      expectedIds,
      readyIds: new Set(),
      markReady(participantId) {
        this.readyIds.add(participantId);
        const ready = [...this.expectedIds].filter((id) => this.readyIds.has(id)).length;
        publishTransferStatus("waiting", Math.round((ready / this.expectedIds.size) * 100));
        if ([...this.expectedIds].every((id) => this.readyIds.has(id))) resolveReady(true);
      }
    };
  }
  if (!expectedIds.size) resolveReady(true);
  else publishTransferStatus("waiting", 0);
  client?.send("sync", { state: command });
  try {
    await readyPromise;
    if (!isCurrentConnection() || hostSongCommandRef?.current?.commandId !== command.commandId)
      return false;
    client?.send("sync", {
      state: { type: "start-karaoke", songId, commandId: command.commandId, revision }
    });
    publishTransferStatus("complete", 100);
    return true;
  } catch (error) {
    publishTransferStatus("error", 0, error?.message || String(error));
    throw error;
  } finally {
    globalThis.clearTimeout(timer);
  }
}

const SONG_SYNC_REQUEST_TIMEOUT_MS = 2 * 60_000;
export function requestSongSync({
  songId,
  ownerId,
  options = {},
  voiceRef,
  roomRef,
  librarySyncRef,
  clientRef,
  setTransferStatus
}) {
  const voice = voiceRef.current;
  const selfId = roomRef.current?.selfId;
  if (!voice || !songId || !ownerId || ownerId === selfId || librarySyncRef.current)
    return Promise.resolve(false);
  const commandId = createCommandId();
  return new Promise((resolve) => {
    const pending = { commandId, songId, ownerId };
    const finish = (result, error) => {
      globalThis.clearTimeout(pending.timer);
      if (librarySyncRef.current === pending) librarySyncRef.current = null;
      if (error) {
        setTransferStatus({
          participantId: ownerId,
          songId,
          commandId,
          stage: "error",
          error: getErrorMessage(error),
          percent: 0
        });
        if (options.roomWide && roomRef.current?.host)
          clientRef.current?.send("sync", {
            state: {
              type: "song-transfer-status",
              participantId: "room",
              songId,
              commandId,
              stage: "error",
              error: getErrorMessage(error),
              percent: 0
            }
          });
      }
      resolve(result);
    };
    pending.resolve = () => finish(true);
    pending.reject = (error) => finish(false, error);
    librarySyncRef.current = pending;
    pending.timer = globalThis.setTimeout(
      () =>
        pending.reject(new Error(translateSaved("room.participantDidNotRespondToTheSongRequest"))),
      SONG_SYNC_REQUEST_TIMEOUT_MS
    );
    setTransferStatus({
      participantId: ownerId,
      songId,
      commandId,
      stage: "waiting",
      percent: 0
    });
    if (options.roomWide && roomRef.current?.host)
      clientRef.current?.send("sync", {
        state: {
          type: "song-transfer-status",
          participantId: "room",
          songId,
          commandId,
          stage: "waiting",
          percent: 0
        }
      });
    voice
      .waitForDataChannel(ownerId, SONG_SYNC_REQUEST_TIMEOUT_MS, voice.lifecycleVersion)
      .then((channel) => {
        if (librarySyncRef.current === pending)
          channel.send(JSON.stringify({ type: "song-sync-request", commandId, songId }));
      })
      .catch((error) => {
        if (librarySyncRef.current === pending) pending.reject(error);
      });
  });
}
