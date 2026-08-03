const DEFAULT_SIGNALING_URL =
  "wss://karaoke-studio-online.pro100dimka-and.workers.dev";

function roomId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9_-]/g, "")
    .slice(0, 32);
}

export class OnlineRoomClient {
  constructor(url = DEFAULT_SIGNALING_URL) {
    this.url = url.replace(/^http/, "ws").replace(/\/$/, "");
    this.listeners = new Set();
    this.socket = null;
  }

  onMessage(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(message) {
    this.listeners.forEach((listener) => listener(message));
  }

  connect({ id, name, host = false }) {
    const normalizedId = roomId(id);
    if (normalizedId.length < 4) {
      return Promise.reject(new Error("Код комнаты должен содержать минимум 4 символа."));
    }
    this.disconnect();
    const query = new URLSearchParams({ name: name?.trim() || "Гость", role: host ? "host" : "guest" });
    const socket = new WebSocket(`${this.url}/rooms/${normalizedId}?${query}`);
    this.socket = socket;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Сервер комнат не ответил.")), 10_000);
      socket.onopen = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      socket.onmessage = (event) => {
        try {
          this.emit(JSON.parse(event.data));
        } catch {
          // Ignore malformed network traffic.
        }
      };
      socket.onerror = () => {
        window.clearTimeout(timeout);
        reject(new Error("Не удалось подключиться к комнате."));
      };
      socket.onclose = () => this.emit({ type: "connection-closed" });
    });
  }

  send(type, payload = {}) {
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type, ...payload }));
    }
  }

  disconnect() {
    this.socket?.close(1000, "Client left room");
    this.socket = null;
  }
}

export const onlineRoomUrl = DEFAULT_SIGNALING_URL;
