import { Minus, Square, X } from "lucide-react";
import { IconButton } from "./ui";

const WINDOW_ACTIONS = [
  { id: "minimize", label: "Свернуть окно", Icon: Minus, size: 14 },
  { id: "maximize", label: "Развернуть окно", Icon: Square, size: 12 },
  { id: "close", label: "Закрыть окно", Icon: X, size: 14, danger: true }
];

function invokeWindowAction(electronAPI, action) {
  Promise.resolve(electronAPI[action]?.()).catch((error) => {
    console.error(`Window action failed: ${action}`, error);
  });
}

export default function TitleBar({ title = "A&D Voice" }) {
  const { electronAPI } = window;

  return (
    <header className="title-bar">
      <div className="title-bar__brand">
        <span className="title-bar__indicator" aria-hidden="true" />
        <span className="text-secondary">{title}</span>
      </div>

      <div className="title-bar__actions">
        {electronAPI &&
          WINDOW_ACTIONS.map(({ id, label, Icon, size, danger }) => (
            <IconButton
              key={id}
              unstyled
              icon={Icon}
              size={size}
              label={label}
              className={`title-bar__button ${danger ? "is-danger" : ""}`.trim()}
              onClick={() => invokeWindowAction(electronAPI, id)}
            />
          ))}
      </div>
    </header>
  );
}
