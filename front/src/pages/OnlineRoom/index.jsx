import { ArrowLeft, UsersRound } from "lucide-react";
import { useRef, useState } from "react";
import { api } from "../../api/client";
import { useOnlineRoom } from "../../contexts/OnlineRoomContext";
import useMountedRef from "../../hooks/useMountedRef";
import { useI18n } from "../../i18n";
import { normalizeRoomId } from "../../services/onlineRoom";
import { Button, Modal, Stack, Typography, RenderFormikFields, useGetForm } from "../../theme/ui";
import { getErrorMessage } from "../../utils/errors";

export function OnlineRoomModal({ onlineName, onOnlineNameChange, onClose }) {
  const { t } = useI18n();
  const room = useOnlineRoom();
  const mounted = useMountedRef();
  const connecting = useRef(false);
  const [form, setForm] = useState({
    busy: false,
    error: "",
    join: false
  });
  const set = (values) => setForm((current) => ({ ...current, ...values }));
  const formik = useGetForm({
    initialValues: { name: onlineName || "", roomId: "" },
    enableReinitialize: false,
    onSubmit: (values) => connect(!form.join, values)
  });
  const connect = async (host, values) => {
    if (!mounted.current || connecting.current) return;
    const name = values.name.trim();
    if (!name) return set({ error: t("room.nameRequired") });
    if (!host && normalizeRoomId(values.roomId).length < 4)
      return set({ error: t("room.theRoomCodeMustContainAtLeast4Characters") });
    connecting.current = true;
    set({ busy: true, error: "" });
    try {
      if (name !== onlineName) {
        const saved = await api.updateAppSettings({ online_name: name });
        if (!mounted.current) return;
        onOnlineNameChange?.(saved?.online_name || name);
      }
      await (host ? room.createRoom(name) : room.joinRoom(normalizeRoomId(values.roomId), name));
      if (mounted.current) onClose();
    } catch (error) {
      if (mounted.current) set({ error: getErrorMessage(error, t("room.join.failed")) });
    } finally {
      connecting.current = false;
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
              disabled={form.busy || (form.join && formik.values.roomId.length < 4)}
              onClick={formik.submitForm}
            >
              {t(action)}
            </Button>
          </>
        )
      }}
    >
      <Stack gap="var(--space-4)" sx={{ padding: "var(--space-4)" }}>
        <form onSubmit={formik.handleSubmit} noValidate>
          <RenderFormikFields
            formik={formik}
            items={[
              {
                tag: "name",
                type: "TextField",
                label: t("room.name"),
                placeholder: t("room.namePlaceholder"),
                maxLength: 80,
                disabled: form.busy
              },
              {
                tag: "roomId",
                type: "TextField",
                label: t("room.code"),
                placeholder: t("room.codeExample"),
                maxLength: 32,
                parse: normalizeRoomId,
                showFor: form.join,
                disabled: form.busy
              }
            ]}
          />
          <button
            type="submit"
            hidden
            disabled={form.busy || (form.join && formik.values.roomId.length < 4)}
          />
        </form>
        {form.error && (
          <Typography role="alert" tone="danger">
            {form.error}
          </Typography>
        )}
      </Stack>
    </Modal>
  );
}
