import { Minus, X } from "lucide-react";
import { useI18n } from "../i18n";
import { IconButton } from "./ui";

const WINDOW_ACTIONS = [
  { id: "minimize", labelKey: "common.minimizeWindow", Icon: Minus, size: 16 },
  {
    id: "close",
    labelKey: "common.closeWindow",
    Icon: X,
    size: 16,
    danger: true
  }
];

function invokeWindowAction(electronAPI, action) {
  Promise.resolve(electronAPI[action]?.()).catch((error) => {
    console.error(`Window action failed: ${action}`, error);
  });
}

export default function TitleBar({ title = "A&D Voice", hideActions = false }) {
  const { electronAPI } = window;
  const { t } = useI18n();

  return (
    <header className="title-bar" aria-label={title}>
      <div className="title-bar__actions">
        {!hideActions &&
          electronAPI &&
          WINDOW_ACTIONS.map(({ id, labelKey, Icon, size, danger }) => (
            <IconButton
              key={id}
              unstyled
              icon={Icon}
              size={size}
              label={t(labelKey)}
              className={`title-bar__button ${danger ? "is-danger" : ""}`.trim()}
              onClick={() => invokeWindowAction(electronAPI, id)}
            />
          ))}
      </div>
    </header>
  );
}
