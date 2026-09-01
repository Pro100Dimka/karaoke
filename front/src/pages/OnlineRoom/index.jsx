import { ArrowLeft, UsersRound } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../api/client";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import useMountedRef from "../../hooks/useMountedRef";
import { useI18n } from "../../i18n";
import { normalizeRoomId } from "../../services/onlineRoom";
import { Button, Modal, RenderFormikFields, Stack, Typography, useGetForm } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";

export function OnlineRoomModal({ onlineName, onOnlineNameChange, onClose }) {
  const { t } = useI18n();
  const room = useOnlineRoom();
  const mounted = useMountedRef();
  const lock = useRef();
  const [state, setState] = useState({ join: false, busy: false, error: "" });
  const set = (value) => setState((state) => ({ ...state, ...value }));

  const formik = useGetForm({
    initialValues: { name: onlineName || "", roomId: "" },
    onSubmit: async ({ name, roomId }) => {
      if (lock.current) return;
      name = name.trim();
      roomId = normalizeRoomId(roomId);
      if (!name) return set({ error: t("room.nameRequired") });
      if (state.join && roomId.length < 4)
        return set({ error: t("room.theRoomCodeMustContainAtLeast4Characters") });
      lock.current = true;
      set({ busy: true, error: "" });
      try {
        if (name !== onlineName) {
          const saved = await api.updateAppSettings({ online_name: name });
          if (!mounted.current) return;
          onOnlineNameChange?.(saved?.online_name || name);
        }
        await (state.join ? room.joinRoom(roomId, name) : room.createRoom(name));
        mounted.current && onClose();
      } catch (error) {
        mounted.current && set({ error: getErrorMessage(error, t("room.join.failed")) });
      } finally {
        lock.current = false;
        mounted.current && set({ busy: false });
      }
    }
  });

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
              disabled={state.busy}
              startIcon={state.join && <ArrowLeft />}
              onClick={() => set({ join: !state.join, error: "" })}
            >
              {t(state.join ? "room.back" : "room.joinByCode")}
            </Button>

            <Button
              fullWidth
              variant="contained"
              disabled={
                state.busy || (state.join && normalizeRoomId(formik.values.roomId).length < 4)
              }
              onClick={formik.submitForm}
            >
              {t(state.busy ? "room.connecting" : `room.${state.join ? "join" : "create"}`)}
            </Button>
          </>
        )
      }}
    >
      <Stack
        as="form"
        gap="var(--space-4)"
        sx={{ padding: "var(--space-4)" }}
        onSubmit={formik.handleSubmit}
      >
        <RenderFormikFields
          formik={formik}
          items={[
            {
              tag: "name",
              type: "TextField",
              label: t("room.name"),
              placeholder: t("room.namePlaceholder"),
              maxLength: 80,
              disabled: state.busy
            },
            state.join && {
              tag: "roomId",
              type: "TextField",
              label: t("room.code"),
              placeholder: t("room.codeExample"),
              maxLength: 32,
              parse: normalizeRoomId,
              disabled: state.busy
            }
          ].filter(Boolean)}
        />

        {state.error && (
          <Typography role="alert" tone="danger">
            {state.error}
          </Typography>
        )}
      </Stack>
    </Modal>
  );
}
