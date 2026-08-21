import { Music2 } from "lucide-react";
import { FieldInput } from "../../../components/fields";
import Modal from "../../../components/modal";
import { translateSaved } from "../../../i18n/runtime";
import { Stack } from "../../../theme/ui";

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
          <Stack gap={1} direction="row">
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
          <div className="library-add-song-file">
            <span className="library-add-song-file-icon">
              <Music2 size={22} />
            </span>
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
