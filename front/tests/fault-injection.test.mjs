import { expect, test, vi } from "vitest";
import { dropDataChannel, dropWebSocket, errorDataChannel } from "./helpers/fault-injection.mjs";
import { FakeChannel } from "./helpers/webrtc.mjs";

test("dropWebSocket fires an unclean close and marks the socket closed", () => {
  const socket = { readyState: 1, onclose: vi.fn() };
  dropWebSocket(socket);
  expect(socket.readyState).toBe(3);
  expect(socket.onclose).toHaveBeenCalledWith({ code: 1006, reason: "", wasClean: false });
});

test("dropWebSocket accepts a custom code and reason", () => {
  const socket = { readyState: 1, onclose: vi.fn() };
  dropWebSocket(socket, { code: 1011, reason: "server error" });
  expect(socket.onclose).toHaveBeenCalledWith({ code: 1011, reason: "server error", wasClean: false });
});

test("dropDataChannel closes the channel and fires onclose", () => {
  const channel = new FakeChannel("open");
  const onclose = vi.fn();
  channel.onclose = onclose;
  dropDataChannel(channel);
  expect(channel.readyState).toBe("closed");
  expect(onclose).toHaveBeenCalledWith({ type: "close" });
});

test("errorDataChannel fires onerror without changing readyState", () => {
  const channel = new FakeChannel("open");
  const onerror = vi.fn();
  channel.onerror = onerror;
  const error = new Error("boom");
  errorDataChannel(channel, error);
  expect(channel.readyState).toBe("open");
  expect(onerror).toHaveBeenCalledWith({ type: "error", error });
});
