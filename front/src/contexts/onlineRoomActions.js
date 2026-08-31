import { translateSaved } from "../i18n/runtime";

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
  if (typeof revision !== "string" || !revision.startsWith("sha256:"))
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
