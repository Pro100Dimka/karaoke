import {
  Check,
  Copy,
  PanelLeftClose,
  PanelLeftOpen,
  ShieldCheck
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOnlineRoom } from "../contexts/OnlineRoomContext";
import useExclusiveAsyncAction from "../hooks/useExclusiveAsyncAction";
import useMountedRef from "../hooks/useMountedRef";
import { useI18n } from "../i18n";
import { Card, IconButton } from "../theme/ui";
import { copyText } from "../utils/clipboard";
import OnlineRoomParticipant from "./OnlineRoomParticipant";
import Button from "./fields/button";

export function OnlineRoomDock() {
  const { t } = useI18n();
  const onlineRoom = useOnlineRoom();
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { pending: requestingMicrophone, run: requestMicrophone } =
    useExclusiveAsyncAction();
  const copiedTimerRef = useRef(null);
  const mountedRef = useMountedRef();

  useEffect(
    () => () => {
      if (copiedTimerRef.current) {
        globalThis.clearTimeout(copiedTimerRef.current);
      }
    },
    []
  );

  if (!onlineRoom?.room) return null;

  const handleRequestMicrophone = () =>
    requestMicrophone(() => onlineRoom.requestMicrophoneAccess());

  const handleCopy = async () => {
    if (!(await copyText(onlineRoom.room.id)) || !mountedRef.current) return;
    setCopied(true);
    if (copiedTimerRef.current) {
      globalThis.clearTimeout(copiedTimerRef.current);
    }
    copiedTimerRef.current = globalThis.setTimeout(() => {
      copiedTimerRef.current = null;
      setCopied(false);
    }, 1600);
  };
  const transferText = onlineRoom.transferStatus
    ? onlineRoom.transferStatus.stage === "error"
      ? t("room.transfer.error", {
          error:
            onlineRoom.transferStatus.error || t("room.transfer.unknownError")
        })
      : t(`room.transfer.${onlineRoom.transferStatus.stage}`, {
          percent: onlineRoom.transferStatus.percent
        })
    : "";

  return (
    <>
      <Card
        className={`online-room-dock ${collapsed ? "is-collapsed" : ""}`}
        aria-hidden={collapsed}
        inert={collapsed ? "" : undefined}
        variant="neon"
        tilt={false}
        aria-label={t("room.participants")}
      >
        <div className="online-room-dock-heading">
          <span>
            {t("room.heading", {
              role: t(
                onlineRoom.room.host
                  ? "room.role.host"
                  : "room.role.participant"
              )
            })}
          </span>
          <div className="online-room-dock-code">
            <IconButton
              icon={PanelLeftClose}
              label={t("room.hidePanel")}
              variant="outline"
              size="sm"
              onClick={() => setCollapsed(true)}
            />
            <strong>{onlineRoom.room.id}</strong>
            <IconButton
              icon={copied ? Check : Copy}
              variant="outline"
              size="sm"
              label={t("room.copyCode")}
              onClick={handleCopy}
            />
          </div>
        </div>

        <div className="online-room-dock-people">
          {onlineRoom.participants.map((person) => (
            <OnlineRoomParticipant
              key={person.id}
              person={person}
              room={onlineRoom.room}
              localSpeakingLevel={onlineRoom.localSpeakingLevel}
              speakingLevel={onlineRoom.speakingLevels[person.id] || 0}
              microphoneMuted={onlineRoom.microphoneMuted}
              roomSoundMuted={onlineRoom.roomSoundMuted}
              isLocallyMuted={onlineRoom.mutedPeople.has(person.id)}
              effectsEnabled={onlineRoom.effectPeople.has(person.id)}
              onLeave={onlineRoom.leaveRoom}
              onSetMicrophoneMuted={onlineRoom.setMicrophoneMuted}
              onSetRoomSoundMuted={onlineRoom.setRoomSoundMuted}
              onTogglePersonMuted={onlineRoom.togglePersonMuted}
              onTogglePersonEffects={onlineRoom.togglePersonEffects}
            />
          ))}
        </div>

        {onlineRoom.voiceError && (
          <div className="online-room-voice-warning">
            <p className="online-room-voice-error">{onlineRoom.voiceError}</p>
            <Button
              unstyled
              icon={ShieldCheck}
              className="btn btn-sm online-room-permission-button"
              onClick={handleRequestMicrophone}
              disabled={requestingMicrophone}
            >
              {t(
                requestingMicrophone
                  ? "room.requestingMicrophone"
                  : "room.allowMicrophone"
              )}
            </Button>
          </div>
        )}
        {onlineRoom.transferStatus && (
          <div
            className="online-room-transfer"
            role="status"
            aria-live="polite"
          >
            <p>{transferText}</p>
            {onlineRoom.transferStatus.stage !== "error" && (
              <progress
                max="100"
                value={onlineRoom.transferStatus.percent}
                aria-label={transferText}
              />
            )}
          </div>
        )}
      </Card>

      {collapsed && (
        <Button
          unstyled
          icon={PanelLeftOpen}
          iconSize={18}
          className="online-room-restore-button"
          onClick={() => setCollapsed(false)}
          title={t("room.showPanel")}
          aria-label={t("room.showPanel")}
        >
          <span>{onlineRoom.room.id}</span>
        </Button>
      )}
    </>
  );
}
