import { Check, Copy, PanelLeftClose, PanelLeftOpen, ShieldCheck } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOnlineRoom, useOnlineRoomSpeaking } from "../contexts/OnlineRoomContext";
import useExclusiveAsyncAction from "../hooks/useExclusiveAsyncAction";
import useMountedRef from "../hooks/useMountedRef";
import { useI18n } from "../i18n";
import { Box, Button, Card, IconButton, Progress, Stack, Typography } from "../theme/ui";
import { copyText } from "../utils/clipboard";
import OnlineRoomParticipant from "./OnlineRoomParticipant";

const ACTIVE_TRANSFER = new Set(["waiting", "sending", "receiving", "importing"]);

export function OnlineRoomDock() {
  const { t } = useI18n();
  const online = useOnlineRoom();
  const { localSpeakingLevel, speakingLevels } = useOnlineRoomSpeaking();
  const mounted = useMountedRef();
  const timer = useRef(null);
  const [copied, setCopied] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const { pending, run } = useExclusiveAsyncAction();
  useEffect(() => () => timer.current && globalThis.clearTimeout(timer.current), []);
  if (!online?.room) return null;
  const copy = async () => {
    if (!(await copyText(online.room.id)) || !mounted.current) return;
    setCopied(true);
    if (timer.current) globalThis.clearTimeout(timer.current);
    timer.current = globalThis.setTimeout(() => {
      timer.current = null;
      setCopied(false);
    }, 1600);
  };
  const transfer = online.transferStatus;
  return (
    <>
      {!collapsed && (
        <Card
          variant="neon"
          tilt={false}
          aria-label={t("room.participants")}
          sx={{
            position: "fixed",
            inset: "auto auto var(--space-5) var(--space-5)",
            zIndex: 20
          }}
        >
          <Stack gap="var(--space-3)" sx={{ padding: "var(--space-4)" }}>
            <Stack direction="row" align="center" justify="space-between" gap="var(--space-4)">
              <Typography as="strong">
                {t("room.heading", {
                  role: t(online.room.host ? "room.role.host" : "room.role.participant")
                })}
              </Typography>
              <Stack
                direction="row"
                align="center"
                gap="var(--space-2)"
                sx={{ inlineSize: "auto" }}
              >
                <IconButton
                  icon={PanelLeftClose}
                  size="sm"
                  variant="outline"
                  label={t("room.hidePanel")}
                  onClick={() => setCollapsed(true)}
                />
                <Typography as="strong">{online.room.id}</Typography>
                <IconButton
                  icon={copied ? Check : Copy}
                  size="sm"
                  variant="outline"
                  label={t("room.copyCode")}
                  onClick={copy}
                />
              </Stack>
            </Stack>
            <Stack gap="var(--space-2)">
              {online.participants.map((person) => (
                <OnlineRoomParticipant
                  key={person.id}
                  person={person}
                  room={online.room}
                  localSpeakingLevel={localSpeakingLevel}
                  speakingLevel={speakingLevels[person.id] || 0}
                  microphoneMuted={online.microphoneMuted}
                  roomSoundMuted={online.roomSoundMuted}
                  isLocallyMuted={online.mutedPeople.has(person.id)}
                  effectsEnabled={online.effectPeople.has(person.id)}
                  participantVolume={online.participantVolumes?.[person.id] ?? 1}
                  transferStatus={online.transferStatuses?.get(person.id)}
                  onLeave={online.leaveRoom}
                  onSetMicrophoneMuted={online.setMicrophoneMuted}
                  onSetRoomSoundMuted={online.setRoomSoundMuted}
                  onSetParticipantVolume={online.setParticipantVolume}
                  onTogglePersonMuted={online.togglePersonMuted}
                  onTogglePersonEffects={online.togglePersonEffects}
                />
              ))}
            </Stack>
            {!online.room.host && !online.participants.some((person) => person.role === "host") && (
              <Typography role="alert" tone="danger">
                {t("room.hostLeft")}
              </Typography>
            )}
            {transfer?.stage === "error" && (
              <Typography role="alert" tone="danger">
                {transfer.error || t("room.transfer.unknownError")}
              </Typography>
            )}
            {ACTIVE_TRANSFER.has(transfer?.stage) && (
              <Progress value={Number(transfer.percent) || 0} />
            )}
            {online.voiceError && (
              <Box role="alert">
                <Typography tone="danger">{online.voiceError}</Typography>
                <Button
                  variant="outlined"
                  startIcon={<ShieldCheck />}
                  disabled={pending}
                  onClick={() => run(() => online.requestMicrophoneAccess())}
                >
                  {t(pending ? "room.requestingMicrophone" : "room.allowMicrophone")}
                </Button>
              </Box>
            )}
          </Stack>
        </Card>
      )}
      {collapsed && (
        <Box
          sx={{ position: "fixed", inset: "auto auto var(--space-5) var(--space-5)", zIndex: 20 }}
        >
          <Button
            variant="outlined"
            startIcon={<PanelLeftOpen />}
            aria-label={t("room.showPanel")}
            onClick={() => setCollapsed(false)}
          >
            {online.room.id}
          </Button>
        </Box>
      )}
    </>
  );
}
