import { CircleDot, Library, OctagonX, Play } from "lucide-react";
import Modal from "../../../components/Modal";
import { ProgressBar, StatusBadge } from "../../../components/ui";
import { formatEta, getProcessingProgress, isProcessingActive } from "../utils";
import LibraryModalHeader from "./LibraryModalHeader";

export default function ProcessingModal({
  song,
  status,
  onCancel,
  onClose,
  onOpenKaraoke
}) {
  const currentStatus = status?.status || song?.status;
  const progress = getProcessingProgress(status, song);

  return (
    <Modal
      isOpen={Boolean(song)}
      onClose={onClose}
      ariaLabel={song ? `Обработка песни ${song.title}` : "Обработка песни"}
      backdropClassName="song-recordings-backdrop"
      modalClassName="processing-modal"
      closeClassName="song-recordings-close"
      closeIconSize={18}
      portal
    >
      {song && (
        <>
          <LibraryModalHeader
            icon={CircleDot}
            eyebrow="ОБРАБОТКА ПЕСНИ"
            title={song.title}
          />
          <StatusBadge status={currentStatus} />
          <div className="processing-modal-progress-head u-row-between">
            <span>{status?.progress_step || "Подготовка"}</span>
            <b>{Math.round(progress)}%</b>
          </div>
          <ProgressBar percent={progress} />
          {isProcessingActive(currentStatus) && (
            <div className="processing-modal-detail u-row-between">
              <span>
                Сейчас: {status?.progress_detail || "подготовка задачи"}
              </span>
              <strong>Осталось: {formatEta(status?.eta_seconds)}</strong>
            </div>
          )}
          {status?.error_message && (
            <p className="song-lyrics-error">
              Ошибка обработки: {status.error_message}
            </p>
          )}
          <div className="processing-modal-actions u-row u-cluster">
            {isProcessingActive(currentStatus) && (
              <button
                className="btn btn-danger"
                onClick={onCancel}
                type="button"
              >
                <OctagonX size={15} /> Отменить
              </button>
            )}
            {currentStatus === "done" && (
              <>
                <button
                  className="btn btn-ghost"
                  onClick={onClose}
                  type="button"
                >
                  <Library size={15} /> В библиотеку
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => onOpenKaraoke(song.id)}
                >
                  <Play size={15} fill="currentColor" /> Открыть в караоке
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
