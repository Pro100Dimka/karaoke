import { ArrowLeft, UsersRound } from "lucide-react";
import { useRef, useState } from "react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import useMountedRef from "../hooks/useMountedRef";
import { normalizeRoomId } from "../services/onlineRoom";
import { getErrorMessage } from "../utils/errors";
import { Button, FieldInput } from "./fields";
import Modal from "./modal";

export function OnlineRoomModal({ onlineName, onClose }) {
  const room = useOnlineRoom();
  const [joinMode, setJoinMode] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const connectionPendingRef = useRef(false);
  const mountedRef = useMountedRef();

  const connect = async (host) => {
    if (connectionPendingRef.current) return;

    const normalizedRoomId = normalizeRoomId(roomId);
    if (!host && normalizedRoomId.length < 4) {
      setError("Введите корректный код комнаты.");
      return;
    }

    connectionPendingRef.current = true;
    setBusy(true);
    setError("");
    try {
      if (host) await room.createRoom(onlineName);
      else await room.joinRoom(normalizedRoomId, onlineName);
      if (mountedRef.current) onClose();
    } catch (connectError) {
      if (mountedRef.current) {
        setError(
          getErrorMessage(connectError, "Не удалось подключиться к комнате.")
        );
      }
    } finally {
      connectionPendingRef.current = false;
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel="Совместное исполнение"
      portal
      backdropClassName="app-modal-backdrop"
      modalClassName="app-modal modal-card online-room-modal"
      closeClassName="app-modal-close"
      closeIconSize={18}
      cardVariant="neon"
      tilt
      titleProps={{
        icon: UsersRound,
        eyebrow: "ОНЛАЙН-КОМНАТА",
        title: "Совместное исполнение",
        description: "Создайте комнату или подключитесь по коду ведущего."
      }}
    >
      <div className="modal-scroll online-room-modal__content">
        {!joinMode ? (
          <div className="online-room-form u-stack-4">
            <p>
              Создайте комнату и отправьте другу автоматически созданный код или
              войдите по коду ведущего.
            </p>
            {error && <p className="karaoke-recording-error">{error}</p>}
            <div className="online-room-actions u-actions-end">
              <Button
                variant="primary"
                disabled={busy}
                onClick={() => connect(true)}
              >
                {busy ? "Подключение…" : "Создать комнату"}
              </Button>
              <Button
                variant="ghost"
                disabled={busy}
                onClick={() => setJoinMode(true)}
              >
                Войти по коду
              </Button>
            </div>
          </div>
        ) : (
          <div className="online-room-form u-stack-4">
            <FieldInput
              id="online-room-code"
              field={{
                name: "roomId",
                label: "Код комнаты",
                placeholder: "Например, E15235FE",
                maxLength: 32
              }}
              value={roomId}
              onChange={(value) => setRoomId(normalizeRoomId(value))}
              onKeyDown={(event) => {
                if (event.key === "Enter" && roomId.length >= 4) {
                  event.preventDefault();
                  connect(false);
                }
              }}
            />
            {error && <p className="karaoke-recording-error">{error}</p>}
            <div className="online-room-actions u-actions-end">
              <Button
                variant="primary"
                disabled={busy || roomId.length < 4}
                onClick={() => connect(false)}
              >
                {busy ? "Подключение…" : "Войти"}
              </Button>
              <Button
                icon={ArrowLeft}
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setJoinMode(false);
                  setError("");
                }}
              >
                Назад
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
