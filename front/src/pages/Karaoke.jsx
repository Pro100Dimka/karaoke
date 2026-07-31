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
  return raw
    .map((note) => ({
      start: Number(note.start),
      end: Number(note.end),
      midi: note.midi ?? note.pitch ?? noteNameToMidi(note.note),
    }))
    .filter((note) => Number.isFinite(note.start) && Number.isFinite(note.end) && Number.isFinite(note.midi));
}

function noteNameToMidi(noteName) {
  if (typeof noteName !== "string") return null;
  const match = /^([A-Ga-g])([#b]?)(-?\d+)$/.exec(noteName.trim());
  if (!match) return null;
  const semitones = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 };
  const [, letter, accidental, octaveText] = match;
  const base = semitones[letter.toUpperCase()];
  const offset = accidental === "#" ? 1 : accidental === "b" ? -1 : 0;
  return (Number(octaveText) + 1) * 12 + base + offset;
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
  const currentTimeRef = useRef(currentTime);
  const durationRef = useRef(duration);
  currentTimeRef.current = currentTime;
  durationRef.current = duration;

  useEffect(() => {
    if (!song || song.status !== "done") return;
    api.getResult(song.id).then(setResult).catch(() => setResult(null));
    setKeyShift(0);
    setShowLyrics(song.show_lyrics ?? true);
    setShowNotes(song.show_notes ?? true);
  }, [song?.id, song?.status]);

  const lyrics = useMemo(() => normalizeLyrics(result?.lyrics_sync), [result]);
  const notes = useMemo(() => normalizeNotes(result?.reference_notes), [result]);

  const currentLineIndex = lyrics.findIndex((l) => currentTime >= l.start && currentTime < l.end);
  const currentLine = lyrics[currentLineIndex];
  const nextLine = lyrics[currentLineIndex + 1];
  const previousLine = lyrics[currentLineIndex - 1];

  // Держим instrumental/vocals синхронизированными между собой.
  useEffect(() => {
    const instr = instrumentalRef.current;
    const voc = vocalsRef.current;
    if (!instr || !voc) return;
    const onLoadedMeta = () => setDuration(instr.duration || 0);
    const onEnded = () => setIsPlaying(false);
    instr.addEventListener("loadedmetadata", onLoadedMeta);
    instr.addEventListener("ended", onEnded);
    return () => {
      instr.removeEventListener("loadedmetadata", onLoadedMeta);
      instr.removeEventListener("ended", onEnded);
    };
  }, [song?.id]);

  useEffect(() => {
    if (!isPlaying) return undefined;
    let animationFrameId;
    const updatePosition = () => {
      const position = instrumentalRef.current?.currentTime;
      if (Number.isFinite(position)) setCurrentTime(position);
      animationFrameId = requestAnimationFrame(updatePosition);
    };
    updatePosition();
    return () => cancelAnimationFrame(animationFrameId);
  }, [isPlaying]);

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

  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.target.closest("input, select, textarea, button")) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        seekTo(Math.max(0, currentTimeRef.current - 5));
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        seekTo(Math.min(durationRef.current, currentTimeRef.current + 5));
      } else if (event.code === "Escape") {
        stop();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [isPlaying]);

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

      {/* Large, high-contrast lyric cue: previous / current / next line. */}
      {showLyrics && (
        <div className="karaoke-lyrics">
          {lyrics.length === 0 && <p className="text-muted">Синхронизированный текст недоступен</p>}
          {previousLine && <div className="karaoke-lyric karaoke-lyric-muted">{previousLine.text}</div>}
          {currentLine ? (
            <div className="karaoke-lyric karaoke-lyric-current">{currentLine.text}</div>
          ) : lyrics.length > 0 && <div className="karaoke-lyric karaoke-lyric-current">Слушайте вступление…</div>}
          {nextLine && <div className="karaoke-lyric karaoke-lyric-next">{nextLine.text}</div>}
        </div>
      )}

      {/* Piano-roll notes: visible pitch lanes make melody and intervals readable. */}
      {showNotes && notes.length > 0 && (
        <MelodyRoll notes={notes} currentTime={currentTime} keyShift={keyShift} />
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

        <p className="text-muted" style={{ margin: "0 0 12px", textAlign: "center", fontSize: 11 }}>
          Space — пуск/пауза · ← / → — перемотка на 5 секунд · Esc — стоп
        </p>

        <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 16, fontSize: 12 }}>
          <SliderField label="Громкость музыки" value={musicVolume} min={0} max={1} step={0.05}
            onChange={setMusicVolume} display={`${Math.round(musicVolume * 100)}%`} disabled={isPlaying} />
          <SliderField label="Громкость вокала" value={vocalVolume} min={0} max={1} step={0.05}
            onChange={setVocalVolume} display={`${Math.round(vocalVolume * 100)}%`} disabled={isPlaying} />
          <SliderField label="Скорость" value={speed} min={0.5} max={1.5} step={0.05}
            onChange={setSpeed} display={`${speed.toFixed(2)}x`} disabled={isPlaying} />
          <SliderField label="Тональность" value={keyShift} min={-6} max={6} step={1}
            onChange={setKeyShift} display={`${keyShift > 0 ? "+" : ""}${keyShift}`} disabled={isPlaying} />
        </div>
      </div>
    </div>
  );
}

function SliderField({ label, value, min, max, step, onChange, display, disabled }) {
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
        disabled={disabled}
        onChange={(e) => onChange(Number(e.target.value))}
        style={{ width: "100%", accentColor: "#a855f7" }}
      />
    </div>
  );
}

function MelodyRoll({ notes, currentTime, keyShift }) {
  const width = 1000;
  const height = 310;
  const windowSeconds = 12;
  const viewStart = Math.max(0, currentTime - 2.5);
  const viewEnd = viewStart + windowSeconds;
  const visibleNotes = notes.filter((note) => note.end >= viewStart && note.start <= viewEnd);
  const scaleNotes = visibleNotes.length > 0 ? visibleNotes : notes;
  const midiValues = scaleNotes.map((n) => n.midi + keyShift);
  const minMidi = Math.floor(Math.min(...midiValues)) - 2;
  const maxMidi = Math.ceil(Math.max(...midiValues)) + 2;
  const pitchRange = Math.max(1, maxMidi - minMidi + 1);
  const rowHeight = height / pitchRange;

  const x = (time) => ((time - viewStart) / windowSeconds) * width;
  const y = (midi) => height - (midi - minMidi + 1) * rowHeight;

  return (
    <div className="melody-roll">
      <div className="melody-roll-caption">Мелодия · текущий фрагмент</div>
      <svg viewBox={`0 0 ${width} ${height}`} width="100%" height={height} preserveAspectRatio="none" aria-label="Ноты мелодии">
        {Array.from({ length: pitchRange }, (_, index) => {
          const midi = minMidi + index;
          const isOctave = midi % 12 === 0;
          return <g key={midi}>
            <line x1={0} x2={width} y1={y(midi) + rowHeight} y2={y(midi) + rowHeight}
              stroke={isOctave ? "rgba(255,255,255,0.22)" : "rgba(255,255,255,0.08)"} />
            {isOctave && <text x={8} y={y(midi) + rowHeight - 4} fill="rgba(255,255,255,0.45)" fontSize="20">C{Math.floor(midi / 12) - 1}</text>}
          </g>;
        })}
        {visibleNotes.map((n, i) => (
          <rect
            key={i}
            x={Math.max(0, x(n.start))}
            y={y(n.midi + keyShift) + 3}
            width={Math.max(4, Math.min(width, x(n.end)) - Math.max(0, x(n.start)) - 2)}
            height={Math.max(8, rowHeight - 6)}
            rx={5}
            fill={currentTime >= n.start && currentTime < n.end ? "#f472b6" : "rgba(139,92,246,0.76)"}
          />
        ))}
        <line x1={x(currentTime)} x2={x(currentTime)} y1={0} y2={height} stroke="#fff" strokeOpacity={0.9} strokeWidth={2} />
      </svg>
    </div>
  );
}
