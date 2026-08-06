import assert from "node:assert/strict";
import test from "node:test";

import { OnlineRoomClient } from "../src/services/onlineRoom.js";

class FakeWebSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = FakeWebSocket.CONNECTING;
    this.sent = [];
    FakeWebSocket.instances.push(this);
  }

  open() {
    this.readyState = FakeWebSocket.OPEN;
    this.onopen?.();
  }

  receive(data) {
    this.onmessage?.({ data });
  }

  send(data) {
    this.sent.push(data);
  }

  close() {
    if (this.readyState === FakeWebSocket.CLOSED) return;
    this.readyState = FakeWebSocket.CLOSED;
    this.onclose?.();
  }

  fail() {
    this.onerror?.();
  }
}

const installWebSocket = () => {
  const previous = globalThis.WebSocket;
  globalThis.WebSocket = FakeWebSocket;
  FakeWebSocket.instances = [];
  return () => {
    globalThis.WebSocket = previous;
  };
};

test("stale socket events cannot close or update the active room", async () => {
  const restore = installWebSocket();
  try {
    const client = new OnlineRoomClient("https://example.test");
    const messages = [];
    client.onMessage((message) => messages.push(message));

    const firstConnect = client.connect({ id: "ROOM1", name: "One" });
    const firstSocket = FakeWebSocket.instances[0];

    const secondConnect = client.connect({ id: "ROOM2", name: "Two" });
    const secondSocket = FakeWebSocket.instances[1];
    secondSocket.open();
    assert.equal(await secondConnect, "ROOM2");

    firstSocket.receive(JSON.stringify({ type: "room-state", id: "old" }));
    firstSocket.close();

    await assert.rejects(firstConnect, /Соединение с комнатой закрыто/);
    assert.equal(client.socket, secondSocket);
    assert.deepEqual(messages, []);
  } finally {
    restore();
  }
});

test("manual disconnect does not emit a stale connection-closed event", async () => {
  const restore = installWebSocket();
  try {
    const client = new OnlineRoomClient("wss://example.test");
    const messages = [];
    client.onMessage((message) => messages.push(message));

    const connecting = client.connect({ id: "ROOM1", name: "One" });
    const socket = FakeWebSocket.instances[0];
    client.disconnect();
    socket.close();

    await assert.rejects(connecting, /Соединение с комнатой закрыто/);
    assert.deepEqual(messages, []);
  } finally {
    restore();
  }
});

test("an active socket emits connection-closed exactly once", async () => {
  const restore = installWebSocket();
  try {
    const client = new OnlineRoomClient("wss://example.test");
    const messages = [];
    client.onMessage((message) => messages.push(message));

    const connecting = client.connect({ id: "ROOM1", name: "One" });
    const socket = FakeWebSocket.instances[0];
    socket.open();
    await connecting;
    socket.close();
    socket.close();

    assert.deepEqual(messages, [{ type: "connection-closed" }]);
    assert.equal(client.socket, null);
  } finally {
    restore();
  }
});

test("send serializes only while the current socket is open", async () => {
  const restore = installWebSocket();
  try {
    const client = new OnlineRoomClient("wss://example.test");
    const connecting = client.connect({ id: "ROOM1", name: "One" });
    const socket = FakeWebSocket.instances[0];

    assert.equal(client.send("presence", { micMuted: true }), false);
    socket.open();
    await connecting;
    assert.equal(client.send("presence", { micMuted: true }), true);
    assert.deepEqual(JSON.parse(socket.sent[0]), {
      type: "presence",
      micMuted: true
    });
  } finally {
    restore();
  }
});

test("connection errors reject once and release the current socket", async () => {
  const restore = installWebSocket();
  try {
    const client = new OnlineRoomClient("wss://example.test");
    const connecting = client.connect({ id: "ROOM1", name: "One" });
    const socket = FakeWebSocket.instances[0];

    socket.fail();
    await assert.rejects(connecting, /Не удалось подключиться к комнате/);
    assert.equal(client.socket, null);
  } finally {
    restore();
  }
});
