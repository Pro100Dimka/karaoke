import { useEffect } from "react";
import LibraryWaveTerrain from "./wave-terrain";

const MUSIC_DECOR = [
  ["record", 4],
  ["notes", 18]
];

function MusicObject({ type, parts }) {
  return (
    <i className={`library-music-object library-music-object--${type}`}>
      {Array.from({ length: parts }, (_, part) => {
        const noteStyle =
          type === "notes"
            ? {
                "--part": part,
                "--note-x": `${(part * 23 + 7) % 96}%`,
                "--note-y": `${18 + ((part * 37 + 11) % 68)}%`,
                "--note-scale": (0.82 + ((part * 17) % 35) / 100).toFixed(2),
                "--note-duration": `${(6.2 + (part % 5) * 0.55).toFixed(2)}s`
              }
            : { "--part": part };

        return <span key={part} style={noteStyle} />;
      })}
    </i>
  );
}

export default function LibraryBackdrop() {
  useEffect(() => {
    const root = document.documentElement;
    let frame = 0;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    const render = () => {
      currentX += (targetX - currentX) * 0.075;
      currentY += (targetY - currentY) * 0.075;
      root.style.setProperty("--library-parallax-x", currentX.toFixed(3));
      root.style.setProperty("--library-parallax-y", currentY.toFixed(3));
      root.style.setProperty(
        "--library-bg-x",
        `${(-currentX * 7).toFixed(2)}px`
      );
      root.style.setProperty(
        "--library-bg-y",
        `${(-currentY * 4).toFixed(2)}px`
      );
      frame = requestAnimationFrame(render);
    };

    const handlePointer = ({ clientX, clientY }) => {
      targetX = (clientX / Math.max(1, innerWidth) - 0.5) * 2;
      targetY = (clientY / Math.max(1, innerHeight) - 0.5) * 2;
    };

    const resetPointer = () => {
      targetX = 0;
      targetY = 0;
    };

    addEventListener("pointermove", handlePointer, { passive: true });
    document.addEventListener("mouseleave", resetPointer);
    frame = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(frame);
      removeEventListener("pointermove", handlePointer);
      document.removeEventListener("mouseleave", resetPointer);
      root.style.removeProperty("--library-parallax-x");
      root.style.removeProperty("--library-parallax-y");
      root.style.removeProperty("--library-bg-x");
      root.style.removeProperty("--library-bg-y");
    };
  }, []);

  return (
    <div className="library-concert-backdrop" aria-hidden="true">
      <div className="library-stage-lights">
        <i />
        <i />
      </div>
      <div className="library-music-decor">
        {MUSIC_DECOR.map(([type, parts]) => (
          <MusicObject key={type} type={type} parts={parts} />
        ))}
      </div>
      <LibraryWaveTerrain />
    </div>
  );
}
