const BLACK_KEYS = new Set([1, 3, 6, 8, 10]);

export const isBlackPianoKey = (midi) => BLACK_KEYS.has(((midi % 12) + 12) % 12);

export const pianoNoteName = (midi) => {
  const names = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];
  const value = Number(midi);
  return `${names[((value % 12) + 12) % 12]}${Math.floor(value / 12) - 1}`;
};

export function buildWhitePianoKeyGeometry({ minMidi, maxMidi, rowHeight, height }) {
  const white = Array.from({ length: maxMidi - minMidi + 1 }, (_, index) => maxMidi - index).filter(
    (midi) => !isBlackPianoKey(midi)
  );
  const centers = white.map((midi) => (maxMidi - midi + 0.5) * rowHeight);
  return white.map((midi, index) => {
    const center = centers[index];
    const previous = index > 0 ? centers[index - 1] : Math.max(0, center - rowHeight * 2);
    const next =
      index + 1 < centers.length ? centers[index + 1] : Math.min(height, center + rowHeight * 2);
    const top = index === 0 ? 0 : (previous + center) / 2;
    const bottom = index === centers.length - 1 ? height : (center + next) / 2;
    return { midi, top, height: Math.max(1, bottom - top) };
  });
}

export default function PianoKeyboard({
  auditionNote,
  height,
  maxMidi,
  minMidi,
  rowHeight,
  whiteKeyGeometry = buildWhitePianoKeyGeometry({ minMidi, maxMidi, rowHeight, height }),
  width
}) {
  const blackKeys = Array.from(
    { length: maxMidi - minMidi + 1 },
    (_, index) => maxMidi - index
  ).filter(isBlackPianoKey);
  const audition = (event, midi) => {
    event.stopPropagation();
    auditionNote?.(midi, 220);
  };
  return (
    <div className="melody-editor-keyboard" style={{ width, height }}>
      {whiteKeyGeometry.map(({ midi, top, height: keyHeight }) => (
        <div
          key={`white-${midi}`}
          className="melody-editor-piano-key is-white"
          style={{ top, width, height: keyHeight }}
          onPointerDown={(event) => audition(event, midi)}
        >
          <span>{pianoNoteName(midi)}</span>
        </div>
      ))}
      {blackKeys.map((midi) => {
        const center = (maxMidi - midi + 0.5) * rowHeight;
        const keyHeight = rowHeight * 0.68;
        return (
          <div
            key={`black-${midi}`}
            className="melody-editor-piano-key is-black"
            style={{ top: center - keyHeight / 2, width: width * 0.64, height: keyHeight }}
            onPointerDown={(event) => audition(event, midi)}
          >
            <span>{pianoNoteName(midi)}</span>
          </div>
        );
      })}
    </div>
  );
}
