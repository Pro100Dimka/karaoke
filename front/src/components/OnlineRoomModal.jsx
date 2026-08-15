import { ArrowLeft, UsersRound } from "lucide-react";
import { useState } from "react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import useMountedRef from "../hooks/useMountedRef";
import { useI18n } from "../i18n";
import { normalizeRoomId } from "../services/onlineRoom";
import { getErrorMessage } from "../utils/errors";
import { Button, FieldInput } from "./fields";
import Modal from "./modal";

export function OnlineRoomModal({ onlineName, onClose }) {
  const { t } = useI18n();
  const room = useOnlineRoom();
  const [joinMode, setJoinMode] = useState(false);
  const [roomId, setRoomId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const mountedRef = useMountedRef();
  const actionKey = busy ? "room.connecting" : `room.${joinMode ? "join" : "create"}`;

  const connect = async (host) => {
    const normalizedRoomId = normalizeRoomId(roomId);
    setBusy(true);
    setError("");
    try {
      if (host) await room.createRoom(onlineName);
      else await room.joinRoom(normalizedRoomId, onlineName);
      if (mountedRef.current) onClose();
    } catch (connectError) {
      if (mountedRef.current) setError(getErrorMessage(connectError, t("room.join.failed")));
    } finally {
      if (mountedRef.current) setBusy(false);
    }
  };

  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={t("room.performance")}
      portal
      backdropClassName="app-modal-backdrop"
      modalClassName="app-modal modal-card online-room-modal"
      closeClassName="app-modal-close"
      closeIconSize={18}
      cardVariant="neon"
      tilt
      titleProps={{
        icon: UsersRound,
        eyebrow: t("room.eyebrow"),
        title: t("room.performance"),
        description: t("room.description"),
        actions: (
          <Button
            variant="primary"
            disabled={busy || (joinMode && roomId.length < 4)}
            onClick={() => connect(!joinMode)}
            className="modal-title-action"
          >
            {t(actionKey)}
          </Button>
        )
      }}
    >
      <div className="modal-scroll online-room-modal__content">
        {!joinMode ? (
          <div className="online-room-form u-stack-4">
            <p>{t("room.instructions")}</p>
            {error && <p className="karaoke-recording-error">{error}</p>}
            <div className="online-room-actions u-actions-end">
              <Button variant="ghost" disabled={busy} onClick={() => setJoinMode(true)}>
                {t("room.joinByCode")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="online-room-form u-stack-4">
            <FieldInput
              id="online-room-code"
              field={{
                name: "roomId",
                label: t("room.code"),
                placeholder: t("room.codeExample"),
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
                icon={ArrowLeft}
                variant="ghost"
                disabled={busy}
                onClick={() => {
                  setJoinMode(false);
                  setError("");
                }}
              >
                {t("room.back")}
              </Button>
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
