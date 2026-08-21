import { Music2, Pause, Play } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toggleAudioPlayback } from "../../../components/audio-player-utils";
import Modal from "../../../components/modal";
import { translateSaved } from "../../../i18n/runtime";
import { FieldInput, Stack } from "../../../theme/ui";
import { getProcessingModeOptions } from "../processing-modes";

export function SelectedFilePreview({ file }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [source, setSource] = useState("");

  useEffect(() => {
    if (!file || typeof URL.createObjectURL !== "function") return undefined;
    const objectUrl = URL.createObjectURL(file);
    setSource(objectUrl);
    return () => {
      audioRef.current?.pause();
      URL.revokeObjectURL(objectUrl);
    };
  }, [file]);

  const Icon = playing ? Pause : Play;
  const label = playing
    ? translateSaved("Приостановить выбранный аудиофайл")
    : translateSaved("Прослушать выбранный аудиофайл");
  return (
    <>
      <button
        className="library-add-song-file-icon"
        type="button"
        aria-label={label}
        title={label}
        disabled={!source}
        onClick={async () => setPlaying(await toggleAudioPlayback(audioRef.current))}
      >
        <Icon size={20} fill={playing ? "currentColor" : "none"} />
      </button>
      <audio
        ref={audioRef}
        src={source}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
      />
    </>
  );
}

export default function AddSongsModal({ review, onCancel, onConfirm, onUpdate }) {
  const item = review?.items?.[review.index];
  return (
    <Modal
      isOpen={Boolean(item)}
      onClose={onCancel}
      ariaLabel={translateSaved("Подтверждение добавления песни")}
      maxWidth="48rem"
      titleProps={{
        icon: Music2,
        image: item?.coverUrl || undefined,
        eyebrow: item
          ? translateSaved("Песня {0} из {1}", {
              0: review.index + 1,
              1: review.items.length
            })
          : "",
        title: translateSaved("Проверьте данные песни"),
        description: translateSaved("Обработка начнётся только после подтверждения всех файлов")
      }}
    >
      {item && (
        <form
          className="library-add-song-form"
          onSubmit={(event) => {
            event.preventDefault();
            onConfirm();
          }}
        >
          <Stack className="library-add-song-fields" gap={1} direction="row">
            <FieldInput
              field={{
                name: "artist",
                type: "text",
                label: translateSaved("Исполнитель"),
                wrapperClassName: "library-add-song-field"
              }}
              value={item.artist}
              onChange={(artist) => onUpdate({ artist })}
            />
            <FieldInput
              field={{
                name: "title",
                type: "text",
                label: translateSaved("Название песни"),
                required: true,
                wrapperClassName: "library-add-song-field"
              }}
              value={item.title}
              onChange={(title) => onUpdate({ title })}
            />
          </Stack>
          <FieldInput
            field={{
              name: "processingMode",
              type: "select",
              label: translateSaved("Режим обработки"),
              hint: translateSaved(
                "Режимы действительно меняют объём вычислений; авто выбирает сбалансированный профиль"
              ),
              options: getProcessingModeOptions(),
              wrapperClassName: "library-add-song-mode"
            }}
            value={item.processingMode}
            onChange={(processingMode) => onUpdate({ processingMode })}
          />
          <div className="library-add-song-file">
            <SelectedFilePreview file={item.file} />
            <span className="library-add-song-file-copy">
              <small>{translateSaved("Выбранный аудиофайл")}</small>
              <strong title={item.file.name}>{item.file.name}</strong>
            </span>
          </div>
          <div className="library-add-song-actions">
            <button className="btn btn-ghost" type="button" onClick={onCancel}>
              {translateSaved("Пропустить")}
            </button>
            <button className="btn btn-primary" type="submit" disabled={!item.title.trim()}>
              {translateSaved("Подтвердить")}
            </button>
          </div>
        </form>
      )}
    </Modal>
  );
}
