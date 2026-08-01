import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate } from "react-router-dom";
import {
  Plus,
  Play,
  Trash2,
  FolderOpen,
  Search,
  Info,
  Settings2,
  MoreHorizontal,
  RotateCcw,
  Headphones,
  BarChart3,
  Music2,
  X,
  CircleDot,
  OctagonX,
  Library as LibraryIcon,
} from "lucide-react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";
import { Panel, StatusBadge, ProgressBar } from "../components/ui";
import { AudioPlayer } from "../components/AudioPlayer";
import { useAppDialog } from "../components/AppDialog";
import libraryNeonSpace from "../assets/karaoke/library-neon-space.webp";

function formatDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("ru-RU");
}

function formatEta(seconds) {
  if (!seconds) return "рассчитываем…";
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.round(seconds % 60);
  return minutes
    ? `~${minutes} мин ${remainingSeconds} сек`
    : `~${remainingSeconds} сек`;
}

export default function Library() {
  const [query, setQuery] = useState("");
  const [infoSong, setInfoSong] = useState(null);
  const [menuSongId, setMenuSongId] = useState(null);
  const [recordingsSong, setRecordingsSong] = useState(null);
  const [processingSong, setProcessingSong] = useState(null);
  const [hiddenSongIds, setHiddenSongIds] = useState(() => new Set());
  const fileInputRef = useRef(null);
  const navigate = useNavigate();
  const { confirm: confirmDialog } = useAppDialog();

  useEffect(() => {
    if (!menuSongId) return undefined;
    const closeMenu = (event) => {
      if (!event.target.closest(".library-card-more")) setMenuSongId(null);
    };
    document.addEventListener("pointerdown", closeMenu);
    return () => document.removeEventListener("pointerdown", closeMenu);
  }, [menuSongId]);

  const { data: songs, error } = usePolling(api.listSongs, 3000, []);
  const { data: songRecordings, error: recordingsError } = usePolling(
    () =>
      recordingsSong
        ? api.listRecordingsForSong(recordingsSong.id)
        : Promise.resolve([]),
    2500,
    [recordingsSong?.id],
  );
  const { data: processingStatus } = usePolling(
    () =>
      processingSong ? api.getStatus(processingSong.id) : Promise.resolve(null),
    1000,
    [processingSong?.id],
  );

  const handleAddClick = useCallback(() => fileInputRef.current?.click(), []);

  const handleFileChosen = useCallback(
    async (e) => {
      const file = e.target.files?.[0];
      e.target.value = "";
      if (!file) return;
      try {
        const song = await api.addSong(file, file.name.replace(/\.[^.]+$/, ""));
        await api.processSong(song.id);
        setProcessingSong(song);
      } catch (err) {
        alert(
          `Не удалось добавить и запустить обработку песни: ${err.message}`,
        );
      }
    },
    [navigate],
  );

  const handleDelete = useCallback(async (song) => {
    if (!(await confirmDialog(`Удалить «${song.title}»? Это удалит все файлы песни.`, "Удалить песню?"))) return;
    try {
      setHiddenSongIds((ids) => new Set(ids).add(song.id));
      setMenuSongId(null);
      if (infoSong?.id === song.id) setInfoSong(null);
      if (recordingsSong?.id === song.id) setRecordingsSong(null);
      if (processingSong?.id === song.id) setProcessingSong(null);
      await api.deleteSong(song.id);
    } catch (err) {
      setHiddenSongIds((ids) => {
        const next = new Set(ids);
        next.delete(song.id);
        return next;
      });
      alert(`Не удалось удалить: ${err.message}`);
    }
  }, [confirmDialog, infoSong?.id, processingSong?.id, recordingsSong?.id]);

  const handleProcess = useCallback(
    async (song) => {
      try {
        await api.processSong(song.id);
        setProcessingSong(song);
      } catch (err) {
        alert(`Не удалось запустить обработку: ${err.message}`);
      }
    },
    [navigate],
  );

  const handleReprocess = useCallback(
    async (song) => {
      try {
        await api.reprocessMelody(song.id);
        setProcessingSong(song);
      } catch (err) {
        alert(`Не удалось переобработать MIDI: ${err.message}`);
      }
    },
    [navigate],
  );

  const handleOpenFolder = useCallback((song) => {
    if (!song.output_dir && !window.electronAPI) {
      alert("Папка ещё не создана — песня не обработана");
      return;
    }
    window.electronAPI?.openPath(song.output_dir || "");
  }, []);

  const handleDeleteRecording = useCallback(async (recording) => {
    if (!confirm("Удалить это записанное исполнение?")) return;
    try {
      await api.deleteRecording(recording.id);
    } catch (err) {
      alert(`Не удалось удалить запись: ${err.message}`);
    }
  }, []);

  const cancelProcessing = useCallback(async () => {
    if (!processingSong || !confirm("Отменить обработку этой песни?")) return;
    try {
      await api.cancelProcessing(processingSong.id);
    } catch (err) {
      alert(`Не удалось отменить обработку: ${err.message}`);
    }
  }, [processingSong]);

  const visibleSongs = (songs || []).filter((song) => !hiddenSongIds.has(song.id));
  const filtered = visibleSongs.filter((s) =>
    [s.title, s.artist, s.genre].filter(Boolean).join(" ").toLowerCase().includes(query.toLowerCase()),
  );
  const readyCount = visibleSongs.filter(
    (song) => song.status === "done",
  ).length;

  return (
    <div className="library-page">
      <div className="library-concert-backdrop" aria-hidden="true">
        <img className="library-neon-space" src={libraryNeonSpace} alt="" />
        <i className="library-bg-vinyl library-bg-vinyl--one" />
        <i className="library-bg-vinyl library-bg-vinyl--two" />
        <i className="library-bg-cassette library-bg-cassette--one">
          <b />
          <b />
        </i>
        <i className="library-bg-cassette library-bg-cassette--two">
          <b />
          <b />
        </i>
        <i className="library-bg-cube library-bg-cube--one" />
        <i className="library-bg-cube library-bg-cube--two" />
        <i className="library-bg-sphere library-bg-sphere--one" />
        <i className="library-bg-sphere library-bg-sphere--two" />
        <i className="library-bg-ring library-bg-ring--one" />
        <i className="library-bg-ring library-bg-ring--two" />
        <div className="library-bg-notes">♪ ♫ ♪ ♬</div>
        <div className="library-bg-pixel-rain">
          {Array.from({ length: 34 }, (_, index) => (
            <i key={index} style={{ "--n": index }} />
          ))}
        </div>
        <div className="library-bg-eq">
          {Array.from({ length: 28 }, (_, index) => (
            <i key={index} style={{ animationDelay: `${index * -110}ms` }} />
          ))}
        </div>
      </div>
      <section className="library-hero">
        <div className="library-hero-3d-scene" aria-hidden="true">
          <i className="library-hero-disc" />
          <i className="library-hero-prism" />
          <i className="library-hero-orbit library-hero-orbit--one" />
          <i className="library-hero-orbit library-hero-orbit--two" />
          <i className="library-hero-spark library-hero-spark--one" />
          <i className="library-hero-spark library-hero-spark--two" />
        </div>
        <div className="library-hero-brand-mark" aria-hidden="true">
          <Music2 size={30} />
          <i />
          <i />
        </div>
        <div className="library-hero-copy">
          <span>ВАША МУЗЫКАЛЬНАЯ КОЛЛЕКЦИЯ</span>
          <h1>Библиотека песен</h1>
          <p>
            Добавляйте треки, управляйте обработкой и открывайте их в караоке.
          </p>
        </div>
        <div className="library-hero-stats">
          <div>
            <b>{visibleSongs.length}</b>
            <span>всего песен</span>
          </div>
          <div>
            <b>{readyCount}</b>
            <span>готово к караоке</span>
          </div>
        </div>
      </section>
      <Panel
        className="library-collection-panel"
        title=" "
        actions={
          <div style={{ display: "flex", gap: 8 }}>
            <button className="btn btn-primary" onClick={handleAddClick}>
              <Plus size={15} /> Добавить песню
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.flac,.m4a,.ogg"
              style={{ display: "none" }}
              onChange={handleFileChosen}
            />
          </div>
        }
      >
        <div className="library-toolbar">
          <div className="library-search">
            <Search
              size={14}
              style={{
                position: "absolute",
                left: 10,
                top: 10,
                color: "var(--text-muted)",
              }}
            />
            <input
              className="input"
              style={{ width: "100%", paddingLeft: 30 }}
              placeholder="Поиск..."
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div className="library-toolbar-actions">
            <button className="btn btn-primary" onClick={handleAddClick}>
              <Plus size={15} /> Добавить песню
            </button>
          </div>
        </div>

        {error && (
          <p style={{ color: "var(--danger)" }}>
            Не удалось загрузить список: {error.message}
          </p>
        )}

        <div className="library-card-deck">
          {filtered.map((song, cardIndex) => {
            const isWorking =
              song.status === "processing" || song.status === "cancelling";
            const isReady = song.status === "done";
            return (
              <article
                className={`library-song-card library-song-card--${song.status}`}
                key={`card-${song.id}`}
                onPointerMove={(event) => {
                  const rect = event.currentTarget.getBoundingClientRect();
                  const x = (event.clientX - rect.left) / rect.width - 0.5;
                  const y = (event.clientY - rect.top) / rect.height - 0.5;
                  event.currentTarget.style.setProperty(
                    "--tilt-x",
                    `${-y * 7}deg`,
                  );
                  event.currentTarget.style.setProperty(
                    "--tilt-y",
                    `${x * 7}deg`,
                  );
                  event.currentTarget.style.setProperty(
                    "--glow-x",
                    `${(x + 0.5) * 100}%`,
                  );
                  event.currentTarget.style.setProperty(
                    "--glow-y",
                    `${(y + 0.5) * 100}%`,
                  );
                }}
                onPointerLeave={(event) => {
                  event.currentTarget.style.removeProperty("--tilt-x");
                  event.currentTarget.style.removeProperty("--tilt-y");
                }}
              >
                <div className="library-song-card-art" aria-hidden="true">
                  <Music2 size={26} />
                  <div className="library-song-card-wave">
                    {[32, 58, 39, 74, 46, 66, 34, 52, 78, 41, 62, 29].map(
                      (height, index) => (
                        <i
                          key={index}
                          style={{
                            height: `${height}%`,
                            animationDelay: `${(cardIndex + index) * -85}ms`,
                          }}
                        />
                      ),
                    )}
                  </div>
                </div>
                <div className="library-song-card-main">
                  <div className="library-song-card-heading">
                    <div className="song-title-content">
                      <span className="song-title-name">{song.title}</span>
                      {song.artist && <span className="song-artist-name">{song.artist}</span>}
                      {song.genre && <span className="song-genre-name">{song.genre}</span>}
                    </div>
                    {!isReady && <StatusBadge status={song.status} />}
                  </div>
                  <p className="library-song-card-meta">
                    {song.key_override || "Тональность определяется"}
                    {song.tempo_override ? ` · ${song.tempo_override} BPM` : ""}
                    {song.difficulty_override
                      ? ` · ${song.difficulty_override}`
                      : ""}
                  </p>
                  {isWorking ? (
                    <button
                      className="library-song-card-progress"
                      onClick={() => setProcessingSong(song)}
                    >
                      <ProgressBar percent={song.progress_percent} />
                      <span>{song.progress_percent}% · Открыть обработку</span>
                    </button>
                  ) : (
                    <div className="library-song-card-ready">
                      <span />
                      {isReady
                        ? "Готова к исполнению"
                        : `${song.progress_percent || 0}% подготовлено`}
                    </div>
                  )}
                  <div className="library-song-card-footer">
                    <span className="text-secondary">
                      {formatDate(song.created_at)}
                    </span>
                    <div className="library-song-card-actions">
                      {isReady ? (
                        <>
                          <button
                            className="btn btn-primary"
                            onClick={() =>
                              navigate("/karaoke", {
                                state: { songId: song.id },
                              })
                            }
                          >
                            <Play size={15} fill="currentColor" /> Караоке
                          </button>
                          <button
                            className="btn btn-ghost"
                            title="Прослушать записи"
                            onClick={() => setRecordingsSong(song)}
                          >
                            <Headphones size={16} />
                          </button>
                        </>
                      ) : (
                        <button
                          className="btn btn-primary"
                          disabled={isWorking}
                          onClick={() => handleProcess(song)}
                        >
                          <Play size={15} fill="currentColor" /> Обработать
                        </button>
                      )}
                      <button
                        className="btn btn-ghost"
                        title="Настройки песни"
                        onClick={() => {
                          navigate("/song-settings", {
                            state: { songId: song.id },
                          });
                          setMenuSongId(null);
                        }}
                      >
                        <Settings2 size={14} />
                      </button>
                      <button
                        className="btn btn-ghost"
                        title="Открыть папку"
                        onClick={() => {
                          handleOpenFolder(song);
                          setMenuSongId(null);
                        }}
                      >
                        <FolderOpen size={14} />
                      </button>
                      {isReady && (
                        <button
                          className="btn btn-ghost"
                          title="Переобработать MIDI"
                          onClick={() => {
                            handleReprocess(song);
                            setMenuSongId(null);
                          }}
                        >
                          <RotateCcw size={14} />
                        </button>
                      )}
                      <div className="library-card-more">
                        <button
                          className="btn btn-ghost"
                          title="Дополнительные действия"
                          onClick={() =>
                            setMenuSongId((id) =>
                              id === song.id ? null : song.id,
                            )
                          }
                        >
                          <MoreHorizontal size={16} />
                        </button>
                      </div>
                      <button
                        className="btn btn-danger"
                        title="Удалить"
                        onClick={() => handleDelete(song)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </div>
                </div>
              </article>
            );
          })}
          {filtered.length === 0 && !error && (
            <div className="library-card-empty text-muted">
              Пока нет ни одной песни — добавьте первую
            </div>
          )}
        </div>
      </Panel>

      {infoSong && (
        <Panel
          title={`Информация — ${infoSong.title}`}
          style={{ marginTop: 18 }}
        >
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 12,
              fontSize: 13,
            }}
          >
            <div>
              <span className="text-muted">Файл: </span>
              {infoSong.original_filename}
            </div>
            <div>
              <span className="text-muted">Тональность: </span>
              {infoSong.key_override || "—"}
            </div>
            <div>
              <span className="text-muted">Темп: </span>
              {infoSong.tempo_override || "—"}
            </div>
            <div>
              <span className="text-muted">Сложность: </span>
              {infoSong.difficulty_override || "—"}
            </div>
            <div>
              <span className="text-muted">Оптимизирована: </span>
              {infoSong.optimized ? "да" : "нет"}
            </div>
            <div>
              <span className="text-muted">Ошибка: </span>
              {infoSong.error_message || "—"}
            </div>
          </div>
          <button
            className="btn btn-ghost"
            style={{ marginTop: 12 }}
            onClick={() => setInfoSong(null)}
          >
            Закрыть
          </button>
        </Panel>
      )}
      {recordingsSong &&
        createPortal(
          <div
            className="song-recordings-backdrop"
            onMouseDown={() => setRecordingsSong(null)}
          >
            <section
              className="song-recordings-modal"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                className="song-recordings-close"
                type="button"
                onClick={() => setRecordingsSong(null)}
                aria-label="Закрыть"
              >
                <X size={18} />
              </button>
              <div className="song-recordings-modal-head">
                <div className="song-recordings-modal-icon">
                  <Music2 size={21} />
                </div>
                <div>
                  <span>ИСПОЛНЕНИЯ ПЕСНИ</span>
                  <h2>{recordingsSong.title}</h2>
                </div>
              </div>
              {recordingsError && (
                <p className="song-lyrics-error">
                  Не удалось загрузить записи: {recordingsError.message}
                </p>
              )}
              <div className="song-recordings-list">
                {(songRecordings || []).map((recording) => (
                  <article key={recording.id} className="song-recording-item">
                    <div>
                      <strong>{formatDate(recording.created_at)}</strong>
                      <span>
                        {recording.duration_sec?.toFixed(1) || "0.0"} сек ·
                        голос и минус
                      </span>
                    </div>
                    <AudioPlayer
                      src={api.getPerformanceFileUrl(recording.id)}
                    />
                    <div className="song-recording-item-actions">
                      <button
                        className="btn btn-ghost"
                        onClick={() => {
                          setRecordingsSong(null);
                          navigate("/analysis", {
                            state: {
                              songId: recordingsSong.id,
                              recordingId: recording.id,
                            },
                          });
                        }}
                      >
                        <BarChart3 size={15} /> Анализ
                      </button>
                      <button
                        className="btn btn-danger"
                        title="Удалить запись"
                        onClick={() => handleDeleteRecording(recording)}
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </article>
                ))}
              </div>
              {(songRecordings || []).length === 0 && !recordingsError && (
                <div className="song-recordings-empty">
                  Для этой песни пока нет записанных исполнений.
                </div>
              )}
            </section>
          </div>,
          document.body,
        )}
      {processingSong &&
        createPortal(
          <div
            className="song-recordings-backdrop"
            onMouseDown={() => setProcessingSong(null)}
          >
            <section
              className="processing-modal"
              onMouseDown={(event) => event.stopPropagation()}
            >
              <button
                className="song-recordings-close"
                type="button"
                onClick={() => setProcessingSong(null)}
                aria-label="Закрыть"
              >
                <X size={18} />
              </button>
              <div className="song-recordings-modal-head">
                <div className="song-recordings-modal-icon">
                  <CircleDot size={21} />
                </div>
                <div>
                  <span>ОБРАБОТКА ПЕСНИ</span>
                  <h2>{processingSong.title}</h2>
                </div>
              </div>
              <StatusBadge
                status={processingStatus?.status || processingSong.status}
              />
              <div className="processing-modal-progress-head">
                <span>{processingStatus?.progress_step || "Подготовка"}</span>
                <b>
                  {Math.round(
                    processingStatus?.progress_percent ??
                      processingSong.progress_percent ??
                      0,
                  )}
                  %
                </b>
              </div>
              <ProgressBar
                percent={
                  processingStatus?.progress_percent ??
                  processingSong.progress_percent ??
                  0
                }
              />
              {(processingStatus?.status === "processing" ||
                processingStatus?.status === "queued") && (
                <div className="processing-modal-detail">
                  <span>
                    Сейчас:{" "}
                    {processingStatus?.progress_detail || "подготовка задачи"}
                  </span>
                  <strong>
                    Осталось: {formatEta(processingStatus?.eta_seconds)}
                  </strong>
                </div>
              )}
              {processingStatus?.error_message && (
                <p className="song-lyrics-error">
                  Ошибка обработки: {processingStatus.error_message}
                </p>
              )}
              <div className="processing-modal-actions">
                {(processingStatus?.status === "processing" ||
                  processingStatus?.status === "queued") && (
                  <button className="btn btn-danger" onClick={cancelProcessing}>
                    <OctagonX size={15} /> Отменить
                  </button>
                )}
                {processingStatus?.status === "done" && (
                  <>
                    <button
                      className="btn btn-ghost"
                      onClick={() => setProcessingSong(null)}
                    >
                      <LibraryIcon size={15} /> В библиотеку
                    </button>
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        navigate("/karaoke", {
                          state: { songId: processingSong.id },
                        })
                      }
                    >
                      <Play size={15} fill="currentColor" /> Открыть в караоке
                    </button>
                  </>
                )}
              </div>
            </section>
          </div>,
          document.body,
        )}
    </div>
  );
}
