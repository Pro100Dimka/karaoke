import { CircleDot, Library, OctagonX, Play } from "lucide-react";
import Button from "../../../components/fields/button";
import Modal from "../../../components/modal";
import { StatusBadge } from "../../../components/ui";
import { translateSaved } from "../../../i18n/runtime";
import ProcessingSignal from "../components/song-card/processing-signal";
import SongCoverArt from "../components/song-card/song-cover-art";
import { formatEta, getProcessingProgress, isProcessingActive } from "../utils";

function getVisibleProgress(progress, active, done) {
  if (done) return 100;
  return active ? Math.max(1, progress) : progress;
}

export default function ProcessingModal({ song, status, onCancel, onClose, onOpenKaraoke }) {
  if (!song) return null;
  const currentStatus = status?.status ?? song.status;
  const progress = getProcessingProgress(status, song);
  const active = isProcessingActive(currentStatus);
  const isDone = currentStatus === "done";
  const visibleProgress = getVisibleProgress(progress, active, isDone);
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
            { fill: "currentColor" }
          ]
        ]
      : [])
  ].filter(Boolean);
  return (
    <Modal
      isOpen
      onClose={onClose}
      ariaLabel={translateSaved("Обработка песни {0}", { 0: song.title })}
      modalClassName="processing-modal"
      titleProps={{
        icon: CircleDot,
        eyebrow: translateSaved("ОБРАБОТКА ПЕСНИ"),
        title: song.title,
        description: translateSaved("Следите за этапами подготовки и управляйте обработкой песни."),
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
          <div className="processing-modal-identity">
            <SongCoverArt song={song} className="processing-modal-art" iconSize={18} />
            <StatusBadge status={currentStatus} />
          </div>
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
            <strong style={{ textAlign: "right", width: "100%" }}>
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
