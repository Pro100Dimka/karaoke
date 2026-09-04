import { describe, expect, test } from "vitest";
import { KaraokeRoom } from "../../cloudflare/src/worker.js";
import { createPlayerSyncCommand } from "../src/pages/Karaoke/utils/transport";
import { createOnlineRoomMessageHandler } from "../src/contexts/onlineRoomMessages";
import { navigateRoomCommand } from "../src/hooks/useOnlineRoomNavigation";
import { vi } from "vitest";

const socket = (id, role) => ({
  messages: [],
  closed: null,
  deserializeAttachment: () => ({ id, role }),
  send(message) {
    this.messages.push(JSON.parse(message));
  },
  close(code, reason) {
    this.closed = { code, reason };
  }
});

describe("frontend transport commands through the room server", () => {
  test.each(["host", "guest"])("%s returns every other participant to the library without closing the room", async (role) => {
    const sender = socket("sender", role);
    const host = socket("host", "host");
    const peer = socket("peer", "guest");
    const sockets = [sender, host, peer];
    const storage = { put: vi.fn().mockResolvedValue(undefined) };
    const room = new KaraokeRoom({ getWebSockets: () => sockets, storage });
    room.playbackState = { state: createPlayerSyncCommand("play", "song", 42), sentAt: Date.now() };
    const state = { type: "open-library" };
    await room.webSocketMessage(sender, JSON.stringify({ type: "sync", state }));
    expect(sender.closed).toBeNull();
    expect(room.playbackState.state).toEqual(state);
    expect(storage.put).toHaveBeenCalledWith("playbackState", room.playbackState);
    for (const recipient of [host, peer]) {
      const navigate = vi.fn();
      const cleanupConnection = vi.fn();
      const receive = createOnlineRoomMessageHandler({
        id: "room",
        client: {},
        voice: {},
        roomRef: { current: { selfId: recipient.deserializeAttachment().id } },
        participantsRef: { current: sockets.map((item) => item.deserializeAttachment()) },
        setRoomCommand: (command) => navigateRoomCommand(command, navigate),
        cleanupConnection
      });
      receive(recipient.messages.at(-1));
      expect(navigate).toHaveBeenCalledWith("/");
      expect(cleanupConnection).not.toHaveBeenCalled();
      expect(recipient.closed).toBeNull();
    }
  });
  test.each(["pause", "stop", "seek", "sync", "play"])("relays an immediate guest %s without disconnecting it", async (action) => {
    const guest = socket("guest", "guest");
    const host = socket("host", "host");
    const peer = socket("peer", "guest");
    const room = new KaraokeRoom({ getWebSockets: () => [guest, host, peer] });
    const state = createPlayerSyncCommand(action, "song", 42);
    await room.webSocketMessage(guest, JSON.stringify({ type: "sync", state }));
    expect(guest.closed).toBeNull();
    expect(state).not.toHaveProperty("executeAt");
    expect(host.messages.at(-1)?.state).toEqual(state);
    expect(peer.messages.at(-1)?.state).toEqual(state);
    expect(room.playbackState.state).toEqual(state);
  });

  test("preserves a scheduled guest start", async () => {
    const guest = socket("guest", "guest");
    const host = socket("host", "host");
    const room = new KaraokeRoom({ getWebSockets: () => [guest, host] });
    const executeAt = Date.now() + 450;
    const state = createPlayerSyncCommand("play", "song", 42, executeAt);
    await room.webSocketMessage(guest, JSON.stringify({ type: "sync", state }));
    expect(guest.closed).toBeNull();
    expect(host.messages.at(-1)?.state.executeAt).toBe(executeAt);
  });

  test.each([null, undefined, 0, NaN, Infinity, "", "0"])("does not serialize an absent or invalid schedule (%s)", (executeAt) => {
    expect(createPlayerSyncCommand("pause", "song", 42, executeAt)).not.toHaveProperty("executeAt");
  });
});
