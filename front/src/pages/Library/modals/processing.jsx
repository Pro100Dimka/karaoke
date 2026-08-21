import { CircleDot, Library, OctagonX, Play } from "lucide-react";
import Button from "../../../components/fields/button";
import Modal from "../../../components/modal";
import ModalCarouselNavigation from "../../../components/modal/carousel-navigation";
import StatusBadge from "../../../components/ui/StatusBadge";
import { translateSaved } from "../../../i18n/runtime";
import ProcessingSignal from "../components/song-card/processing-signal";
import useSongCover from "../hooks/useSongCover";
import { formatEta, getProcessingProgress, isProcessingActive } from "../utils";

function getVisibleProgress(progress, active, done) {
  if (done) return 100;
  return active ? Math.max(1, progress) : progress;
}

export default function ProcessingModal({
  song,
  songs = [],
  status,
  onCancel,
  onClose,
  onOpenKaraoke,
  onSelectSong
}) {
  const visibleStatus = !status?.song_id || status.song_id === song?.id ? status : null;
  const currentStatus = visibleStatus?.status ?? song?.status;
  const { coverUrl, hasCover, handleCoverError } = useSongCover(song?.id, currentStatus);
  if (!song) return null;
  const progress = getProcessingProgress(visibleStatus, song);
  const active = isProcessingActive(currentStatus);
  const isDone = currentStatus === "done";
  const visibleProgress = getVisibleProgress(progress, active, isDone);
  const carouselSongs = songs.some((item) => item.id === song.id) ? songs : [song, ...songs];
  const songIndex = carouselSongs.findIndex((item) => item.id === song.id);
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
        image: hasCover ? coverUrl : undefined,
        onImageError: handleCoverError,
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
        <ModalCarouselNavigation
          ariaLabel={translateSaved("Очередь песен")}
          className="processing-song-carousel"
          index={songIndex}
          count={carouselSongs.length}
          title={translateSaved("Песня {0} из {1}", { 0: songIndex + 1, 1: carouselSongs.length })}
          subtitle={song.artist || translateSaved("Исполнитель не указан")}
          previousLabel={translateSaved("Предыдущая песня")}
          nextLabel={translateSaved("Следующая песня")}
          onPrevious={() => onSelectSong(carouselSongs[songIndex - 1])}
          onNext={() => onSelectSong(carouselSongs[songIndex + 1])}
        />
        <div>
          <StatusBadge status={currentStatus} />
        </div>
        <ProcessingSignal progress={visibleProgress} />
        <div className="processing-modal-stage u-between-3">
          <span>
            {isDone
              ? translateSaved("Песня готова к караоке")
              : (visibleStatus?.progress_detail ??
                visibleStatus?.progress_step ??
                translateSaved("Подготавливаем обработку песни"))}
          </span>
          {active && (
            <strong style={{ textAlign: "right", width: "100%" }}>
              {translateSaved("Осталось:")}
              {formatEta(visibleStatus?.eta_seconds)}
            </strong>
          )}
        </div>
        {visibleStatus?.error_message && (
          <p className="field-error">
            {translateSaved("Ошибка обработки:")}
            {visibleStatus.error_message}
          </p>
        )}
      </div>
    </Modal>
  );
}
