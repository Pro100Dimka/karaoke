import { ArrowLeft, UsersRound } from "lucide-react";
import { translateSaved as tr } from "../../../../i18n/runtime";
import { normalizeRoomId } from "../../../../services/onlineRoom";
import { Button, Modal, RenderFormikFields, Stack, Typography } from "../../../../theme/ui";
import getRows from "./rows";
import useRoomModal from "./use-room-modal";

export function OnlineRoomModal(props) {
  const { form, join, busy, error, toggle } = useRoomModal(props);
  const fields = getRows(busy);
  const invalidCode = join && normalizeRoomId(form.values.roomId).length < 4;

  return (
    <Modal
      isOpen
      portal
      size="sm"
      onClose={props.onClose}
      ariaLabel={tr("room.performance")}
      titleProps={{
        icon: UsersRound,
        eyebrow: tr("room.eyebrow"),
        title: tr("room.performance"),
        description: tr("room.description"),
        actions: (
          <>
            <Button
              fullWidth
              variant="outlined"
              disabled={busy}
              startIcon={join && <ArrowLeft />}
              onClick={toggle}
            >
              {tr(join ? "room.back" : "room.joinByCode")}
            </Button>

            <Button
              fullWidth
              variant="contained"
              disabled={busy || invalidCode}
              onClick={form.submitForm}
            >
              {tr(busy ? "room.connecting" : `room.${join ? "join" : "create"}`)}
            </Button>
          </>
        )
      }}
    >
      <Stack
        as="form"
        gap="var(--space-4)"
        sx={{ padding: "var(--space-4)" }}
        onSubmit={form.handleSubmit}
      >
        <RenderFormikFields formik={form} items={fields} />
        {error && (
          <Typography role="alert" tone="danger">
            {error}
          </Typography>
        )}
      </Stack>
    </Modal>
  );
}
