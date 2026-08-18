import { translateSaved } from "../i18n/runtime";
import { generateId as createCommandId } from "../utils/id";

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
  const previous = hostSongCommandRef?.current;
  if (previous?.commandId && previous.commandId !== command.commandId) {
    voice?.cancelTransfersByCommandId?.(previous.commandId);
    // Without this, an earlier still-pending openKaraokeInRoom() call (host picked a
    // different song before everyone caught up on the first one) would just sit on its own
    // readyPromise until its 5-minute timeout fires, surfacing a confusing stale error long
    // after the host has moved on to the next song.
    previous.rejectReady?.(
      new Error(translateSaved("Ведущий выбрал другую песню до готовности этой"))
    );
  }

  const expectedIds = new Set(
    (participantsRef?.current || [])
      .filter((participant) => participant?.id && participant.id !== room?.selfId)
      .map((participant) => participant.id)
  );
  let resolveReady;
  let rejectReadyRaw;
  const readyPromise = new Promise((resolve, reject) => {
    resolveReady = resolve;
    rejectReadyRaw = reject;
  });
  const timer = globalThis.setTimeout(
    () =>
      rejectReadyRaw(
        new Error(translateSaved("Передача песни остановилась: нет ответа от участника"))
      ),
    SONG_READY_TIMEOUT_MS
  );
  const rejectReady = (error) => {
    globalThis.clearTimeout(timer);
    rejectReadyRaw(error);
  };
  if (hostSongCommandRef) {
    hostSongCommandRef.current = {
      ...command,
      expectedIds,
      readyIds: new Set(),
      rejectReady,
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
