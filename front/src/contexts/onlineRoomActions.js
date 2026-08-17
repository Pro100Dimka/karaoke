import { translateSaved } from "../i18n/runtime";

function createCommandId() {
  return typeof globalThis.crypto?.randomUUID === "function"
    ? globalThis.crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

const SONG_READY_TIMEOUT_MS = 5 * 60_000;

export async function openKaraokeInRoom({
  songId,
  room,
  client,
  roomApi,
  isCurrentConnection,
  hostSongCommandRef,
  participantsRef,
  voice
}) {
  if (room && !room.host) return false;
  if (!isCurrentConnection()) return true;
  const revisionPayload = await roomApi?.getSongRevision?.(songId);
  const revision = revisionPayload?.revision;
  if (typeof revision !== "string" || !revision.startsWith("sha256:"))
    throw new Error(translateSaved("Не удалось определить версию содержимого песни"));
  if (!isCurrentConnection()) return false;

  const command = { type: "open-karaoke", songId, commandId: createCommandId(), revision };
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
        new Error(translateSaved("Передача песни остановилась: нет ответа от участника"))
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
        if ([...this.expectedIds].every((id) => this.readyIds.has(id))) resolveReady(true);
      }
    };
  }
  if (!expectedIds.size) resolveReady(true);
  client?.send("sync", { state: command });
  try {
    await readyPromise;
    if (!isCurrentConnection() || hostSongCommandRef?.current?.commandId !== command.commandId)
      return false;
    client?.send("sync", {
      state: { type: "start-karaoke", songId, commandId: command.commandId, revision }
    });
    return true;
  } finally {
    globalThis.clearTimeout(timer);
  }
}
