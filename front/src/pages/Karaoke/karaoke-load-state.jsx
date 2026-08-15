import { translateSaved } from "../../i18n/runtime";

export default function KaraokeLoadState({
  songs,
  songsError,
  song,
  songId,
  result,
  resultLoading,
  resultError
}) {
  if (songsError) {
    return (
      <div className="panel">
        <p className="field-error">
          {translateSaved("Не удалось загрузить библиотеку:")}{" "}
          {songsError.message || translateSaved("ошибка соединения")}.
        </p>
      </div>
    );
  }
  if (!songs) {
    return (
      <div className="panel">
        <p className="text-muted">{translateSaved("Загружаем песню…")}</p>
      </div>
    );
  }
  if (!song) {
    return (
      <div className="panel">
        <p className="text-muted">
          {songId
            ? translateSaved(
                "Выбранная песня не найдена. Вернитесь в Библиотеку и откройте её снова."
              )
            : translateSaved(
                "Нет готовой песни для воспроизведения. Сначала обработайте песню в Библиотеке."
              )}
        </p>
      </div>
    );
  }
  if (song.status !== "done") {
    return (
      <div className="panel">
        <p className="text-muted">
          «{song.title}
          {translateSaved("» ещё не обработана — статус:")}
          {song.status}.
        </p>
      </div>
    );
  }
  if (resultLoading) {
    return (
      <div className="panel">
        <p className="text-muted">{translateSaved("Загружаем данные караоке…")}</p>
      </div>
    );
  }
  if (resultError || !result) {
    return (
      <div className="panel">
        <p className="field-error">
          {translateSaved("Не удалось загрузить данные караоке:")}{" "}
          {resultError?.message || translateSaved("результат обработки отсутствует")}.
        </p>
      </div>
    );
  }
  return null;
}
