import assert from "node:assert/strict";
import test from "node:test";

import { KaraokeRoom } from "../src/worker.js";

class LoadSocket {
  constructor(id, role = "guest") {
    this.participant = { id, role };
    this.count = 0;
  }

  deserializeAttachment() {
    return this.participant;
  }

  send() {
    this.count += 1;
  }
}

test("twelve participants sustain a burst of shared room commands", async () => {
  const host = new LoadSocket("host", "host");
  const guests = Array.from({ length: 11 }, (_, index) => new LoadSocket(`guest-${index}`));
  const sockets = [host, ...guests];
  const room = new KaraokeRoom({ getWebSockets: () => sockets });
  const started = performance.now();

  for (let index = 0; index < 400; index += 1) {
    await room.webSocketMessage(
      host,
      JSON.stringify({ type: "ui", state: { query: `song-${index}` } })
    );
  }

  assert.equal(guests.reduce((total, socket) => total + socket.count, 0), 4_400);
  assert.ok(performance.now() - started < 5000);
});
