import { ArrowLeft, UsersRound } from "lucide-react";
import { useState } from "react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import { normalizeRoomId } from "../services/onlineRoom";
import Modal from "./Modal";

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

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel="Совместное исполнение"
      portal
      backdropClassName="online-room-backdrop"
      modalClassName="online-room-modal"
      closeClassName="karaoke-settings-close"
      closeIconSize={18}
    >
      <div className="microphone-panel-title">
        <UsersRound size={17} aria-hidden="true" /> Совместное исполнение
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
          <label htmlFor="online-room-code">
            Код комнаты
            <input
              id="online-room-code"
              className="input"
              value={roomId}
              placeholder="Например, E15235FE"
              maxLength={32}
              onChange={(event) =>
                setRoomId(normalizeRoomId(event.target.value))
              }
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
              <ArrowLeft size={15} aria-hidden="true" /> Назад
            </button>
          </div>
        </div>
      )}
    </Modal>
  );
}
