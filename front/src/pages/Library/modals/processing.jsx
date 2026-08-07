import { CircleDot, Library, OctagonX, Play } from "lucide-react";
import Button from "../../../components/fields/button";
import Modal from "../../../components/modal";
import { StatusBadge } from "../../../components/ui";
import ProcessingSignal from "../components/processing-signal";
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
  const actions = [
    active && [OctagonX, "Отменить", "danger", onCancel],
    ...(isDone
      ? [
          [Library, "В библиотеку", "ghost", onClose],
          [
            Play,
            "Открыть",
            "primary",
            () => onOpenKaraoke(song.id),
            { fill: "currentColor" }
          ]
        ]
      : [])
  ].filter(Boolean);
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={`Обработка песни ${song.title}`}
      modalClassName="processing-modal"
      titleProps={{
        icon: CircleDot,
        eyebrow: "ОБРАБОТКА ПЕСНИ",
        title: song.title,
        description:
          "Следите за этапами подготовки и управляйте обработкой песни.",
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
          <strong>{Math.round(progress)}%</strong>
        </div>
        <ProcessingSignal progress={progress} />
        <div className="processing-modal-stage u-between-3">
          <span>{status?.progress_step ?? "Подготовка"}</span>
          {active && (
            <strong style={{ textAlign: "right", width: "100%" }}>
              Осталось: {formatEta(status?.eta_seconds)}
            </strong>
          )}
        </div>
        {status?.error_message && (
          <p className="field-error">
            Ошибка обработки: {status.error_message}
          </p>
        )}
      </div>
    </Modal>
  );
}
