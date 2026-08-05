import { Minus, Square, X } from "lucide-react";

const WINDOW_ACTIONS = [
  { id: "minimize", label: "Свернуть окно", Icon: Minus, size: 14 },
  { id: "maximize", label: "Развернуть окно", Icon: Square, size: 12 },
  { id: "close", label: "Закрыть окно", Icon: X, size: 14, danger: true }
];

export default function TitleBar({ title = "Karaoke Studio" }) {
  const { electronAPI } = window;

  return (
    <header className="title-bar">
      <div className="title-bar__brand">
        <span className="title-bar__indicator" aria-hidden="true" />
        <span className="text-secondary">{title}</span>
      </div>

      {electronAPI && (
        <div className="title-bar__actions">
          {WINDOW_ACTIONS.map(({ id, label, Icon, size, danger }) => (
            <button
              key={id}
              type="button"
              className={`title-bar__button ${danger ? "is-danger" : ""}`.trim()}
              aria-label={label}
              onClick={() => electronAPI[id]()}
            >
              <Icon size={size} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
    </header>
  );
}
