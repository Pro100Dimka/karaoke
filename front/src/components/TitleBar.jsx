import { Minus, Radio, Square, X } from "lucide-react";
import { useRadio } from "../contexts/radio";
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

export default function TitleBar({ title = "Karaoke Studio" }) {
  const { electronAPI } = window;
  const { error, isLoading, isPlaying, toggle } = useRadio();

  return (
    <header className="title-bar">
      <div className="title-bar__brand">
        <span className="title-bar__indicator" aria-hidden="true" />
        <span className="text-secondary">{title}</span>
      </div>

      <div className="title-bar__actions">
        <IconButton
          unstyled
          icon={Radio}
          size={15}
          label={
            error || (isPlaying ? "Выключить радио" : "Включить SomaFM USA")
          }
          className={[
            "title-bar__button title-bar__radio",
            isPlaying && "is-playing",
            isLoading && "is-loading"
          ]
            .filter(Boolean)
            .join(" ")}
          onClick={toggle}
        />
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
