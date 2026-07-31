import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import {
  Play, Pause, Square, SkipBack, SkipForward, Maximize, Type, AudioLines,
} from "lucide-react";
import { api } from "../api/client";
import { usePolling } from "../hooks/usePolling";

// ПРИМЕЧАНИЕ ПО СХЕМЕ ДАННЫХ: здесь предполагается, что lyrics.json — это
// массив строк вида {start, end, text}, а reference.json — массив нот вида
// {start, end, midi}. Если реальная структура AI-пайплайна отличается по
// именам полей, поправить нужно только в двух местах ниже —
// normalizeLyrics()/normalizeNotes() — остальной компонент от конкретной
// формы данных не зависит.
function normalizeLyrics(raw) {
  if (!raw) return [];
  const list = Array.isArray(raw) ? raw : raw.lines || raw.segments || [];
  return list
    .map((l) => ({ start: l.start ?? l.begin ?? 0, end: l.end ?? l.start + 2, text: l.text || l.line || "" }))
    .filter((l) => l.text);
}

function normalizeNotes(raw) {
  if (!raw) return [];
  return raw.map((n) => ({
    start: n.start,
    end: n.end,
    midi: n.midi ?? n.pitch ?? 60,
  }));
}

function formatTime(sec) {
  if (!Number.isFinite(sec)) return "00:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export default function Karaoke() {
  const location = useLocation();
  const { data: songs } = usePolling(api.listSongs, 5000, []);
  const [songId] = useState(location.state?.songId || null);
  const song = songId ? (songs || []).find((s) => s.id === songId) : (songs || []).find((s) => s.status === "done");

  const [result, setResult] = useState(null);
  const instrumentalRef = useRef(null);
  const vocalsRef = useRef(null);
  const containerRef = useRef(null);

  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [musicVolume, setMusicVolume] = useState(1);
  const [vocalVolume, setVocalVolume] = useState(1);
  const [speed, setSpeed] = useState(1);
  // ВАЖНО: keyShift сейчас смещает только отображаемую линию мелодии
  // (транспонирует ноты на экране), а НЕ реальный питч аудио — честный
  // питч-шифтинг воспроизведения в браузере требует DSP-библиотеки вроде
  // SoundTouch-js/Rubberband и здесь не реализован. Если нужен настоящий
  // сдвиг тональности звука — это отдельная задача.
  const [keyShift, setKeyShift] = useState(0);
  const [showLyrics, setShowLyrics] = useState(true);
  const [showNotes, setShowNotes] = useState(true);

  useEffect(() => {
    if (!song || song.status !== "done") return;
    api.getResult(song.id).then(setResult).catch(() => setResult(null));
    setKeyShift(0);
  }, [song?.id, song?.status]);

  const lyrics = useMemo(() => normalizeLyrics(result?.lyrics_sync), [result]);
  const notes = useMemo(() => normalizeNotes(result?.reference_notes), [result]);

  const currentLineIndex = lyrics.findIndex((l) => currentTime >= l.start && currentTime < l.end);
  const currentLine = lyrics[currentLineIndex];
  const nextLine = lyrics[currentLineIndex + 1];

  // Держим instrumental/vocals синхронизированными между собой.
  useEffect(() => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    const onTimeUpdate = () => setCurrentTime(instr.currentTime);
    const onLoadedMeta = () => setDuration(instr.duration || 0);
    const onEnded = () => setIsPlaying(false);
    instr.addEventListener("timeupdate", onTimeUpdate);
    instr.addEventListener("loadedmetadata", onLoadedMeta);
    instr.addEventListener("ended", onEnded);
    return () => {
      instr.removeEventListener("timeupdate", onTimeUpdate);
      instr.removeEventListener("loadedmetadata", onLoadedMeta);
      instr.removeEventListener("ended", onEnded);
    };
  }, [song?.id]);

  useEffect(() => {
    if (instrumentalRef.current) instrumentalRef.current.volume = musicVolume;
  }, [musicVolume]);
  useEffect(() => {
    if (vocalsRef.current) vocalsRef.current.volume = vocalVolume;
  }, [vocalVolume]);
  useEffect(() => {
    [instrumentalRef.current, vocalsRef.current].forEach((el) => el && (el.playbackRate = speed));
  }, [speed]);

  const togglePlay = async () => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    if (isPlaying) {
      instr.pause();
      voc.pause();
    } else {
      voc.currentTime = instr.currentTime;
      try {
        await Promise.all([instr.play(), voc.play()]);
      } catch {
        setIsPlaying(false);
        return;
      }
    }
    setIsPlaying(!isPlaying);
  };

  const stop = () => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    instr.pause();
    voc.pause();
    instr.currentTime = 0;
    voc.currentTime = 0;
    setIsPlaying(false);
    setCurrentTime(0);
  };

  const seekTo = (time) => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    instr.currentTime = time;
    voc.currentTime = time;
    setCurrentTime(time);
  };

  const skip = (delta) => seekTo(Math.max(0, Math.min(duration, currentTime + delta)));

  const toggleFullscreen = () => {
    if (!containerRef.current) return;
    if (document.fullscreenElement) document.exitFullscreen();
    else containerRef.current.requestFullscreen();
  };

  if (!song) {
    return (
      <div className="panel">
        <p className="text-muted">Нет готовой песни для воспроизведения. Сначала обработайте песню в Библиотеке.</p>
      </div>
    );
  }
  if (song.status !== "done") {
    return (
      <div className="panel">
        <p className="text-muted">«{song.title}» ещё не обработана — статус: {song.status}.</p>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="panel"
      style={{
        padding: 0,
        overflow: "hidden",
        position: "relative",
        minHeight: 560,
        background:
          "linear-gradient(rgba(10,7,21,0.55), rgba(10,7,21,0.75)), radial-gradient(circle at 50% 20%, rgba(139,92,246,0.35), transparent 60%)",
      }}
    >
      <audio ref={instrumentalRef} src={api.getAudioTrackUrl(song.id, "instrumental")} preload="auto" />
      <audio ref={vocalsRef} src={api.getAudioTrackUrl(song.id, "vocals")} preload="auto" />

      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: "18px 24px 0" }}>
        <div>
          <div style={{ fontSize: 12, color: "var(--text-muted)" }}>Сейчас играет</div>
          <div style={{ fontSize: 18, fontWeight: 700 }}>{song.title}</div>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          <button className={`btn ${showLyrics ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowLyrics((v) => !v)}>
            <Type size={14} /> Текст
          </button>
          <button className={`btn ${showNotes ? "btn-primary" : "btn-ghost"}`} onClick={() => setShowNotes((v) => !v)}>
            <AudioLines size={14} /> Ноты
          </button>
          <button className="btn btn-ghost" onClick={toggleFullscreen}>
            <Maximize size={14} />
          </button>
        </div>
      </div>

      {/* Текст с подсветкой текущей строки */}
      {showLyrics && (
        <div style={{ textAlign: "center", padding: "48px 40px 24px", minHeight: 180 }}>
          {lyrics.length === 0 && <p className="text-muted">Синхронизированный текст недоступен</p>}
          {currentLine && (
            <div
              style={{
                fontSize: 30,
                fontWeight: 800,
                background: "var(--accent-gradient)",
                WebkitBackgroundClip: "text",
                WebkitTextFillColor: "transparent",
                marginBottom: 14,
              }}
            >
              {currentLine.text}
            </div>
          )}
          {nextLine && <div style={{ fontSize: 20, color: "var(--text-secondary)" }}>{nextLine.text}</div>}
        </div>
      )}

      {/* Линия мелодии */}
      {showNotes && notes.length > 0 && (
        <MelodyLine notes={notes} currentTime={currentTime} duration={duration} keyShift={keyShift} />
      )}

      {/* Таймлайн + транспорт */}
      <div style={{ padding: "12px 24px 22px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 10 }}>
          <span className="mono text-muted" style={{ fontSize: 12, width: 40 }}>{formatTime(currentTime)}</span>
          <input
            type="range"
            min={0}
            max={duration || 0}
            value={currentTime}
            onChange={(e) => seekTo(Number(e.target.value))}
            style={{ flex: 1, accentColor: "#a855f7" }}
          />
          <span className="mono text-muted" style={{ fontSize: 12, width: 40 }}>{formatTime(duration)}</span>
        </div>

        <div style={{ display: "flex", justifyContent: "center", alignItems: "center", gap: 14, marginBottom: 18 }}>
          <button className="btn btn-ghost" onClick={() => skip(-5)}><SkipBack size={16} /></button>
          <button
            className="btn btn-primary"
            style={{ width: 46, height: 46, borderRadius: "50%", justifyContent: "center" }}
            onClick={togglePlay}
          >
            {isPlaying ? <Pause size={18} /> : <Play size={18} />}
          </button>
          <button className="btn btn-ghost" onClick={stop}><Square size={16} /></button>
          <button className="btn btn-ghost" onClick={() => skip(5)}><SkipForward size={16} /></button>
        </div>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, fontSize: 12 }}>
          <SliderField label="Громкость музыки" value={musicVolume} min={0} max={1} step={0.05}
            onChange={setMusicVolume} display={`${Math.round(musicVolume * 100)}%`} />
          <SliderField label="Громкость вокала" value={vocalVolume} min={0} max={1} step={0.05}
            onChange={setVocalVolume} display={`${Math.round(vocalVolume * 100)}%`} />
          <SliderField label="Скорость" value={speed} min={0.5} max={1.5} step={0.05}
            onChange={setSpeed} display={`${speed.toFixed(2)}x`} />
          <SliderField label="Тональность" value={keyShift} min={-6} max={6} step={1}
            onChange={setKeyShift} display={`${keyShift > 0 ? "+" : ""}${keyShift}`} />
        </div>
      </div>
    </div>
  );
}

function SliderField({ label, value, min, max, step, onChange, display }) {
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", color: "var(--text-secondary)", marginBottom: 4 }}>
        <span>{label}</span>
        <span className="mono">{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#a855f7" }}
      />
    </div>
  );
}

function MelodyLine({ notes, currentTime, duration, keyShift }) {
  const width = 900;
  const height = 90;
  const midiValues = notes.map((n) => n.midi + keyShift);
  const minMidi = Math.min(...midiValues) - 2;
  const maxMidi = Math.max(...midiValues) + 2;
  const span = Math.max(1, maxMidi - minMidi);
  const total = duration || Math.max(...notes.map((n) => n.end), 1);

  const x = (t) => (t / total) * width;
  const y = (midi) => height - ((midi - minMidi) / span) * height;

  return (
    <div style={{ padding: "0 24px 8px", overflow: "hidden" }}>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none">
        {notes.map((n, i) => (
          <rect
            key={i}
            x={x(n.start)}
            y={y(n.midi + keyShift) - 3}
            width={Math.max(2, x(n.end) - x(n.start) - 1)}
            height={6}
            rx={3}
            fill={currentTime >= n.start && currentTime < n.end ? "#ec4899" : "rgba(139,92,246,0.55)"}
          />
        ))}
        <line x1={x(currentTime)} x2={x(currentTime)} y1={0} y2={height} stroke="#fff" strokeOpacity={0.4} strokeWidth={1.5} />
      </svg>
    </div>
  );
}
