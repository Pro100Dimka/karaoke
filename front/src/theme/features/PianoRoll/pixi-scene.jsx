import "@pixi/unsafe-eval";
import { Graphics, Stage, useTick } from "@pixi/react";
import { useCallback, useLayoutEffect, useRef } from "react";
import { clamp } from "../../../utils/math";
import { pianoRollFrame } from "./geometry";

function RollGraphics({ currentTime, currentTimeRef, isPitchDetected, notes, palette, size, sung }) {
  const graphicsRef = useRef(null);
  const draw = useCallback(
    (time) => {
      const graphics = graphicsRef.current;
      if (!graphics) return;
      const frame = pianoRollFrame(notes, time, size, sung);
      graphics.clear();
      for (const note of frame.notes) {
        const height = clamp(frame.rowHeight * 0.72, 5, 15);
        const y = frame.y(note.note) + (frame.rowHeight - height) / 2;
        const opacity =
          note.state === "past"
            ? clamp(0.58 * (1 - (frame.time - note.end) / 2.8), 0.08, 0.58)
            : 1;
        graphics.lineStyle(note.state === "current" ? 1.8 : 1.1, palette.highlight, opacity);
        graphics.beginFill(note.state === "current" ? palette.hover : palette.primary, opacity);
        graphics.drawRoundedRect(
          note.left,
          y,
          Math.max(1.5, note.right - note.left),
          height,
          height / 2
        );
        graphics.endFill();
      }
      graphics.lineStyle(2.2, palette.hover, 1);
      graphics.moveTo(frame.playhead, 0);
      graphics.lineTo(frame.playhead, frame.height);
      if (
        isPitchDetected &&
        Number.isFinite(sung) &&
        sung >= frame.min &&
        sung <= frame.max
      ) {
        graphics.lineStyle(2, palette.success, 1);
        graphics.beginFill(palette.text, 1);
        graphics.drawCircle(
          frame.playhead,
          frame.y(sung) + frame.rowHeight / 2,
          Math.max(3, frame.rowHeight * 0.2)
        );
        graphics.endFill();
      }
    },
    [isPitchDetected, notes, palette, size, sung]
  );
  useLayoutEffect(
    () => draw(Number(currentTimeRef?.current ?? currentTime) || 0),
    [currentTime, currentTimeRef, draw]
  );
  useTick(() => {
    if (currentTimeRef) draw(Number(currentTimeRef.current) || 0);
  });
  return <Graphics ref={graphicsRef} />;
}

export default function PixiPianoRoll(props) {
  return (
    <Stage
      width={props.size.width}
      height={props.size.height}
      options={{
        antialias: true,
        backgroundAlpha: 0,
        autoDensity: true,
        resolution: globalThis.devicePixelRatio || 1
      }}
      style={{ display: "block", width: "100%", height: "100%" }}
    >
      <RollGraphics {...props} />
    </Stage>
  );
}
