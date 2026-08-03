const endpoint = (process.argv[2] || "https://karaoke-studio-online.pro100dimka-and.workers.dev")
  .replace(/^http/, "ws")
  .replace(/\/$/, "");
const roomId = `TEST${Date.now().toString(36).toUpperCase()}`;

function connect(name, role) {
  const socket = new WebSocket(
    `${endpoint}/rooms/${roomId}?${new URLSearchParams({ name, role })}`,
  );
  const messages = [];
  socket.addEventListener("message", (event) => messages.push(JSON.parse(event.data)));
  return { socket, messages };
}

function waitFor(client, predicate, label, timeout = 8_000) {
  return new Promise((resolve, reject) => {
    const found = client.messages.find(predicate);
    if (found) return resolve(found);
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label}`)), timeout);
    const listener = (event) => {
      const message = JSON.parse(event.data);
      if (predicate(message)) {
        clearTimeout(timer);
        client.socket.removeEventListener("message", listener);
        resolve(message);
      }
    };
    client.socket.addEventListener("message", listener);
  });
}

function waitOpen(client, label) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout: ${label} socket open`)), 8_000);
    client.socket.addEventListener("open", () => { clearTimeout(timer); resolve(); }, { once: true });
    client.socket.addEventListener("error", () => { clearTimeout(timer); reject(new Error(`${label} socket error`)); }, { once: true });
  });
}

async function run() {
  console.log(`Testing ${endpoint} in room ${roomId}`);
  const host = connect("Host test", "host");
  await waitOpen(host, "host");
  const hostState = await waitFor(host, (message) => message.type === "room-state", "host room state");
  const hostId = hostState.self.id;

  const guest = connect("Guest test", "guest");
  await waitOpen(guest, "guest");
  const guestState = await waitFor(guest, (message) => message.type === "room-state", "guest room state");
  const guestId = guestState.self.id;
  await waitFor(host, (message) => message.type === "participant-joined" && message.participant.id === guestId, "guest joined");

  host.socket.send(JSON.stringify({ type: "chat", text: "room-test" }));
  await waitFor(guest, (message) => message.type === "chat" && message.text === "room-test", "chat delivery");

  host.socket.send(JSON.stringify({ type: "sync", state: { songId: "song-test", position: 12.5, playing: true } }));
  await waitFor(guest, (message) => message.type === "sync" && message.state?.position === 12.5, "playback sync");

  host.socket.send(JSON.stringify({ type: "signal", targetId: guestId, signal: { type: "offer", sdp: "test" } }));
  await waitFor(guest, (message) => message.type === "signal" && message.fromId === hostId, "WebRTC signalling");

  host.socket.close();
  await waitFor(guest, (message) => message.type === "participant-left" && message.participantId === hostId, "host leaves");
  guest.socket.close();
  console.log("PASS: room, participants, chat, sync and WebRTC signalling work.");
}

run().catch((error) => {
  console.error(`FAIL: ${error.message}`);
  process.exitCode = 1;
});
