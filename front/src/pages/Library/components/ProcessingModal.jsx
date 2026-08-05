import { CircleDot, Library, OctagonX, Play } from "lucide-react";
import Modal from "../../../components/Modal";
import { StatusBadge } from "../../../components/ui";
import { formatEta, getProcessingProgress, isProcessingActive } from "../utils";
import LibraryModalHeader from "./LibraryModalHeader";
import ProcessingSignal from "./ProcessingSignal";

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
      backdropClassName="app-modal-backdrop song-recordings-backdrop"
      modalClassName="app-modal modal-card processing-modal"
      closeClassName="app-modal-close song-recordings-close"
      cardVariant="neon"
      closeIconSize={18}
      portal
    >
      {song && (
        <>
          <LibraryModalHeader
            icon={CircleDot}
            eyebrow="ОБРАБОТКА ПЕСНИ"
            title={song.title}
            description="Следите за этапами подготовки и управляйте обработкой песни."
          />

          <div className="processing-modal-body modal-scroll">
            <div className="processing-modal-summary u-row-between">
              <StatusBadge status={currentStatus} />
              <strong>{Math.round(progress)}%</strong>
            </div>

            <ProcessingSignal progress={progress} />

            <div className="processing-modal-stage">
              <span>{status?.progress_step || "Подготовка"}</span>
              {isProcessingActive(currentStatus) && (
                <strong>Осталось: {formatEta(status?.eta_seconds)}</strong>
              )}
            </div>

            <p className="processing-modal-description">
              Сейчас: {status?.progress_detail || "подготовка задачи"}
            </p>

            {status?.error_message && (
              <p className="field-error">
                Ошибка обработки: {status.error_message}
              </p>
            )}
          </div>

          <div className="processing-modal-actions">
            {isProcessingActive(currentStatus) && (
              <button className="btn btn-danger" onClick={onCancel} type="button">
                <OctagonX size={15} /> Отменить
              </button>
            )}
            {currentStatus === "done" && (
              <>
                <button className="btn btn-ghost" onClick={onClose} type="button">
                  <Library size={15} /> В библиотеку
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={() => onOpenKaraoke(song.id)}
                >
                  <Play size={15} fill="currentColor" /> Открыть
                </button>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
