import { ArrowLeft, UsersRound } from "lucide-react";
import { useState } from "react";
import { api } from "../../api/client";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import useMountedRef from "../../hooks/useMountedRef";
import { useI18n } from "../../i18n";
import { normalizeRoomId } from "../../services/onlineRoom";
import { Button, FieldInput, Modal, Stack, Typography } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";

export function OnlineRoomModal({ onlineName, onOnlineNameChange, onClose }) {
  const { t } = useI18n();
  const room = useOnlineRoom();
  const mounted = useMountedRef();
  const [form, setForm] = useState({
    busy: false,
    error: "",
    join: false,
    name: onlineName || "",
    roomId: ""
  });
  const set = (values) => setForm((current) => ({ ...current, ...values }));
  const connect = async (host) => {
    if (form.busy) return;
    const name = form.name.trim();
    if (!name) return set({ error: t("room.nameRequired") });
    set({ busy: true, error: "" });
    try {
      if (name !== onlineName) {
        const saved = await api.updateAppSettings({ online_name: name });
        onOnlineNameChange?.(saved?.online_name || name);
      }
      await (host ? room.createRoom(name) : room.joinRoom(normalizeRoomId(form.roomId), name));
      if (mounted.current) onClose();
    } catch (error) {
      if (mounted.current) set({ error: getErrorMessage(error, t("room.join.failed")) });
    } finally {
      if (mounted.current) set({ busy: false });
    }
  };
  const action = form.busy ? "room.connecting" : `room.${form.join ? "join" : "create"}`;
  return (
    <Modal
      isOpen
      portal
      size="sm"
      onClose={onClose}
      ariaLabel={t("room.performance")}
      titleProps={{
        icon: UsersRound,
        eyebrow: t("room.eyebrow"),
        title: t("room.performance"),
        description: t("room.description"),
        actions: (
          <>
            <Button
              fullWidth
              variant="outlined"
              disabled={form.busy}
              startIcon={form.join ? <ArrowLeft /> : undefined}
              onClick={() => set({ join: !form.join, error: "" })}
            >
              {t(form.join ? "room.back" : "room.joinByCode")}
            </Button>
            <Button
              variant="contained"
              fullWidth
              disabled={form.busy || (form.join && form.roomId.length < 4)}
              onClick={() => connect(!form.join)}
            >
              {t(action)}
            </Button>
          </>
        )
      }}
    >
      <Stack gap="var(--space-4)" sx={{ padding: "var(--space-4)" }}>
        <FieldInput
          field={{
            name: "onlineName",
            label: t("room.name"),
            placeholder: t("room.namePlaceholder"),
            maxLength: 80
          }}
          value={form.name}
          onChange={(name) => set({ name })}
        />
        {form.join && (
          <FieldInput
            field={{
              name: "roomId",
              label: t("room.code"),
              placeholder: t("room.codeExample"),
              maxLength: 32
            }}
            value={form.roomId}
            onChange={(roomId) => set({ roomId: normalizeRoomId(roomId) })}
            onKeyDown={(event) => {
              if (event.key === "Enter" && form.roomId.length >= 4 && !form.busy) {
                event.preventDefault();
                connect(false);
              }
            }}
          />
        )}
        {form.error && (
          <Typography role="alert" tone="danger">
            {form.error}
          </Typography>
        )}
      </Stack>
    </Modal>
  );
}
