import { Music2 } from "lucide-react";
import Modal from "../../../components/modal";
import { translateSaved } from "../../../i18n/runtime";

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
          <div className="library-add-song-file">
            <span className="library-add-song-file-icon">
              <Music2 size={22} />
            </span>
            <span className="library-add-song-file-copy">
              <small>{translateSaved("Выбранный аудиофайл")}</small>
              <strong title={item.file.name}>{item.file.name}</strong>
            </span>
          </div>
          <div className="library-add-song-fields">
            <label className="library-add-song-field">
              <span>{translateSaved("Название песни")}</span>
              <input
                className="input"
                required
                value={item.title}
                onChange={(event) => onUpdate({ title: event.target.value })}
              />
            </label>
            <label className="library-add-song-field">
              <span>{translateSaved("Исполнитель")}</span>
              <input
                className="input"
                value={item.artist}
                onChange={(event) => onUpdate({ artist: event.target.value })}
              />
            </label>
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
