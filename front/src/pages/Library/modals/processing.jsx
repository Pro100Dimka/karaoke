import { CircleAlert, CircleDot, Library, OctagonX, Play } from "lucide-react";
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

export function getProcessingFailureInfo(message) {
  const raw = String(message || "").trim();
  const separator = raw.indexOf(":");
  const type = separator > 0 ? raw.slice(0, separator).trim() : "ProcessingError";
  const reason = separator > 0 ? raw.slice(separator + 1).trim() : raw;
  const normalized = raw.toLowerCase();
  let hint = translateSaved(
    "Повторите обработку. Если ошибка повторится, откройте журнал выполнения ниже."
  );
  if (normalized.includes("ctc") || normalized.includes("model unavailable")) {
    hint = translateSaved(
      "Модель синхронизации недоступна. Проверьте установку AI-моделей и повторите обработку."
    );
  } else if (normalized.includes("timestamp") || normalized.includes("interval")) {
    hint = translateSaved(
      "Не удалось построить корректные интервалы слов по вокалу. Проверьте текст и повторите обработку."
    );
  }
  return { type, reason: reason || translateSaved("Причина не передана backend"), hint };
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
  const isFailed = currentStatus === "error";
  const isCancelled = currentStatus === "cancelled";
  const errorMessage = visibleStatus?.error_message ?? song.error_message;
  const failure = isFailed ? getProcessingFailureInfo(errorMessage) : null;
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
        {!isFailed && !isCancelled && <ProcessingSignal progress={visibleProgress} />}
        {failure ? (
          <section className="processing-modal-error" role="alert">
            <div className="processing-modal-error__title">
              <CircleAlert size={22} aria-hidden="true" />
              <strong>{translateSaved("Обработка остановлена")}</strong>
            </div>
            <p>{failure.reason}</p>
            <dl>
              <div>
                <dt>{translateSaved("Тип ошибки")}</dt>
                <dd>{failure.type}</dd>
              </div>
              <div>
                <dt>{translateSaved("Этап")}</dt>
                <dd>
                  {visibleStatus?.progress_detail ??
                    visibleStatus?.progress_step ??
                    song.progress_step ??
                    translateSaved("Не указан")}
                </dd>
              </div>
              <div>
                <dt>{translateSaved("Выполнено")}</dt>
                <dd>{Math.round(progress)}%</dd>
              </div>
            </dl>
            <p className="processing-modal-error__hint">{failure.hint}</p>
            <button
              type="button"
              className="processing-modal-error__log-link"
              onClick={() => globalThis.electronAPI?.openApplicationLog?.()}
            >
              {translateSaved("Открыть журнал выполнения")}
            </button>
          </section>
        ) : (
          <div className="processing-modal-stage u-between-3">
            <span>
              {isDone
                ? translateSaved("Песня готова к караоке")
                : isCancelled
                  ? translateSaved("Обработка отменена")
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
        )}
      </div>
    </Modal>
  );
}
