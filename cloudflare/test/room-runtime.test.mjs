import assert from "node:assert/strict";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Miniflare } from "miniflare";

test("real Workers WebSockets: guest controls, host grace, resume and explicit exit", { timeout: 20000 }, async () => {
  const mf = new Miniflare({
    workers: [{
    modules: true,
    scriptPath: fileURLToPath(new URL("../src/worker.js", import.meta.url)),
    modulesRules: [{ type: "ESModule", include: ["**/*.js"] }],
    compatibilityDate: "2026-08-03",
    durableObjects: { ROOMS: { className: "KaraokeRoom", useSQLite: true } },
    }],
  });
  const token = "a".repeat(64);
  const connections = [];
  async function join(params) {
    const response = await mf.dispatchFetch(`https://worker.test/rooms/ROOM?v=1&${params}`, { headers: { Upgrade: "websocket" } });
    assert.equal(response.status, 101);
    const socket = response.webSocket;
    const messages = [];
    socket.addEventListener("message", ({ data }) => messages.push(JSON.parse(data)));
    socket.accept();
    connections.push(socket);
    const wait = async (type) => {
      for (let n = 0; n < 200; n++) {
        const found = messages.find((message) => message.type === type);
        if (found) return found;
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
      throw new Error(`Missing ${type}; received: ${JSON.stringify(messages)}`);
    };
    return { socket, messages, wait };
  }
  try {
    const host = await join(`role=host&create=1&hostToken=${token}`);
    const first = await host.wait("room-state");
    const guest = await join("role=guest&sessionId=guest-secret");
    await guest.wait("room-state");
    guest.socket.send(JSON.stringify({ type: "ui", state: { query: "Ария", karaoke: { speed: 1.1 } } }));
    assert.equal((await host.wait("ui")).state.query, "Ария");
    assert.equal((await guest.wait("ui")).state.karaoke.speed, 1.1);
    host.socket.close(4001, "Simulated network interruption");
    assert.equal((await guest.wait("host-reconnecting")).participantId, first.self.id);
    const resumed = await join(`role=host&hostToken=${token}`);
    const snapshot = await resumed.wait("room-state");
    assert.equal(snapshot.self.id, first.self.id);
    assert.equal(snapshot.sharedUi.query, "Ария");
    await guest.wait("host-reconnected");
    resumed.socket.close(1000, "Client left room");
    assert.equal((await guest.wait("room-closed")).reason, "host-left");
  } finally {
    for (const socket of connections) { try { socket.close(); } catch {} }
    await mf.dispose();
  }
});
