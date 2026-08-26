// Reusable, deterministic fault-injection helpers for tests (TASK 44.3).
// Each helper fires the same event a browser would fire on a real abrupt
// failure -- an unclean WebSocket close, a dropped RTCDataChannel -- against
// whatever fake socket/channel object a test has already wired up.

export function dropWebSocket(socket, { code = 1006, reason = "" } = {}) {
  socket.readyState = 3; // WebSocket.CLOSED
  socket.onclose?.({ code, reason, wasClean: false });
}

export function dropDataChannel(channel) {
  channel.readyState = "closed";
  channel.onclose?.({ type: "close" });
}

export function errorDataChannel(channel, error = new Error("simulated data channel error")) {
  channel.onerror?.({ type: "error", error });
}
