import { CircleDot, Library, OctagonX, Play } from "lucide-react";
import Button from "../../../components/fields/button";
import { StatusBadge } from "../../../components/ui";
import { formatEta, getProcessingProgress, isProcessingActive } from "../utils";
import LibraryModal from "./LibraryModal";
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
    <LibraryModal
      isOpen={Boolean(song)}
      onClose={onClose}
      ariaLabel={song ? `Обработка песни ${song.title}` : "Обработка песни"}
      modalClassName="processing-modal"
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
              <Button variant="danger" icon={OctagonX} onClick={onCancel}>
                Отменить
              </Button>
            )}
            {currentStatus === "done" && (
              <>
                <Button variant="ghost" icon={Library} onClick={onClose}>
                  В библиотеку
                </Button>
                <Button
                  variant="primary"
                  icon={Play}
                  iconProps={{ fill: "currentColor" }}
                  onClick={() => onOpenKaraoke(song.id)}
                >
                  Открыть
                </Button>
              </>
            )}
          </div>
        </>
      )}
    </LibraryModal>
  );
}
