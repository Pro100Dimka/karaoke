import { useState } from "react";
import { createPortal } from "react-dom";
import { ArrowLeft, UsersRound, X } from "lucide-react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import { normalizeRoomId } from "../services/onlineRoom";

export function OnlineRoomModal({ onlineName, onClose }) {
  const room = useOnlineRoom();
  const [joinMode, setJoinMode] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const connect = async (host) => {
    setBusy(true);
    setError("");
    try {
      if (host) await room.createRoom(onlineName);
      else await room.joinRoom(roomId, onlineName);
      onClose();
    } catch (connectError) {
      setError(connectError?.message || "Не удалось подключиться к комнате.");
    } finally {
      setBusy(false);
    }
  };

  return createPortal(
    <div className="online-room-backdrop" onMouseDown={onClose}>
      <section
        className="online-room-modal"
        role="dialog"
        aria-modal="true"
        aria-label="Совместное исполнение"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <button
          type="button"
          className="karaoke-settings-close"
          onClick={onClose}
          aria-label="Закрыть"
        >
          <X size={18} />
        </button>
        <div className="microphone-panel-title">
          <UsersRound size={17} /> Совместное исполнение
        </div>

        {!joinMode ? (
          <div className="online-room-form">
            <p>
              Создайте комнату и отправьте другу автоматически созданный код или
              войдите по коду ведущего.
            </p>
            {error && <p className="karaoke-recording-error">{error}</p>}
            <div className="online-room-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy}
                onClick={() => connect(true)}
              >
                {busy ? "Подключение…" : "Создать комнату"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => setJoinMode(true)}
              >
                Войти по коду
              </button>
            </div>
          </div>
        ) : (
          <div className="online-room-form">
            <label>
              Код комнаты
              <input
                autoFocus
                className="input"
                value={roomId}
                placeholder="Например, E15235FE"
                maxLength={32}
                onChange={(event) => setRoomId(normalizeRoomId(event.target.value))}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && roomId.length >= 4) connect(false);
                }}
              />
            </label>
            {error && <p className="karaoke-recording-error">{error}</p>}
            <div className="online-room-actions">
              <button
                type="button"
                className="btn btn-primary"
                disabled={busy || roomId.length < 4}
                onClick={() => connect(false)}
              >
                {busy ? "Подключение…" : "Войти"}
              </button>
              <button
                type="button"
                className="btn btn-ghost"
                disabled={busy}
                onClick={() => {
                  setJoinMode(false);
                  setError("");
                }}
              >
                <ArrowLeft size={15} /> Назад
              </button>
            </div>
          </div>
        )}
      </section>
    </div>,
    document.body,
  );
}
