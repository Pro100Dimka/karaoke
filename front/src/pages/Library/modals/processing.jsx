import { CircleDot, Library, OctagonX, Play } from "lucide-react";
import Button from "../../../components/fields/button";
import Modal from "../../../components/modal";
import { StatusBadge } from "../../../components/ui";
import { translateSaved } from "../../../i18n/runtime";
import ProcessingSignal from "../components/song-card/processing-signal";
import { formatEta, getProcessingProgress, isProcessingActive } from "../utils";

export default function ProcessingModal({
  song,
  status,
  onCancel,
  onClose,
  onOpenKaraoke
}) {
  if (!song) return null;
  const currentStatus = status?.status ?? song.status;
  const progress = getProcessingProgress(status, song);
  const active = isProcessingActive(currentStatus);
  const isDone = currentStatus === "done";
  const visibleProgress = isDone
    ? 100
    : active
      ? Math.max(1, progress)
      : progress;
  const actions = [
    active && [OctagonX, translateSaved("Отменить"), "danger", onCancel],
    ...(isDone
      ? [
          [Library, translateSaved("В библиотеку"), "ghost", onClose],
          [
            Play,
            translateSaved("Открыть"),
            "primary",
            () => onOpenKaraoke(song.id),
            {
              fill: "currentColor"
            }
          ]
        ]
      : [])
  ].filter(Boolean);
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={translateSaved("Обработка песни {0}", {
        0: song.title
      })}
      modalClassName="processing-modal"
      titleProps={{
        icon: CircleDot,
        eyebrow: translateSaved("ОБРАБОТКА ПЕСНИ"),
        title: song.title,
        description: translateSaved(
          "Следите за этапами подготовки и управляйте обработкой песни."
        ),
        actions: actions.map(([Icon, text, variant, onClick, iconProps]) => (
          <Button
            key={text}
            variant={variant}
            icon={Icon}
            iconProps={iconProps}
            onClick={onClick}
            className="modal-title-action"
          >
            {text}
          </Button>
        ))
      }}
    >
      <div className="processing-modal-body modal-scroll">
        <div className="processing-modal-summary u-row-between">
          <StatusBadge status={currentStatus} />
          <strong>{Math.round(visibleProgress)}%</strong>
        </div>
        <ProcessingSignal progress={visibleProgress} />
        <div className="processing-modal-stage u-between-3">
          <span>
            {isDone
              ? translateSaved("Песня готова к караоке")
              : (status?.progress_detail ??
                status?.progress_step ??
                translateSaved("Подготавливаем обработку песни"))}
          </span>
          {active && (
            <strong
              style={{
                textAlign: "right",
                width: "100%"
              }}
            >
              {translateSaved("Осталось:")}
              {formatEta(status?.eta_seconds)}
            </strong>
          )}
        </div>
        {status?.error_message && (
          <p className="field-error">
            {translateSaved("Ошибка обработки:")}
            {status.error_message}
          </p>
        )}
      </div>
    </Modal>
  );
}
