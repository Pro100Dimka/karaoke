import { useState } from "react";
import { api } from "../../../../api/client";
import { useOnlineRoom } from "../../../../contexts/OnlineRoomContext";
import useMountedRef from "../../../../hooks/useMountedRef";
import { translateSaved as tr } from "../../../../i18n/runtime";
import { normalizeRoomId } from "../../../../services/onlineRoom";
import { useGetForm } from "../../../../theme/ui";
import { getErrorMessage } from "../../../../utils/errors";

export default ({ onlineName, onOnlineNameChange, onClose }) => {
  const room = useOnlineRoom();
  const mounted = useMountedRef();
  const [join, setJoin] = useState(false);
  const [error, setError] = useState("");
  const form = useGetForm({
    initialValues: { name: onlineName || "", roomId: "" },
    onSubmit: async ({ name, roomId }) => {
      name = name.trim();
      roomId = normalizeRoomId(roomId);
      if (!name) return setError(tr("room.nameRequired"));
      if (join && roomId.length < 4)
        return setError(tr("room.theRoomCodeMustContainAtLeast4Characters"));
      setError("");
      try {
        if (name !== onlineName) {
          const saved = await api.updateAppSettings({ online_name: name });
          if (!mounted.current) return;
          onOnlineNameChange?.(saved?.online_name || name);
        }
        await (join ? room.joinRoom(roomId, name) : room.createRoom(name));
        if (mounted.current) onClose();
      } catch (error) {
        if (mounted.current) setError(getErrorMessage(error, tr("room.join.failed")));
      }
    }
  });
  return {
    form,
    join,
    error,
    busy: form.isSubmitting,
    toggle: () => {
      setJoin((value) => !value);
      setError("");
    }
  };
};
