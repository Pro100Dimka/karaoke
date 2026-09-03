import { translateSaved as tr } from "../../../../i18n/runtime";
import { normalizeRoomId } from "../../../../services/onlineRoom";

export default (busy, join) => [
  { tag: "name", label: tr("room.name"), placeholder: tr("room.namePlaceholder"), disabled: busy },
  join && {
    tag: "roomId",
    label: tr("room.code"),
    placeholder: tr("room.codeExample"),
    parse: normalizeRoomId,
    disabled: busy
  }
].filter(Boolean);
