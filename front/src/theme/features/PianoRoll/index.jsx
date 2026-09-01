import {
  lazy,
  memo,
  Suspense,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState
} from "react";
import { translateSaved as t } from "../../../i18n/runtime";
import Box from "../../ui/Box";
import PianoKeyboard from "../../ui/PianoKeyboard";
import { drawPianoRoll } from "./draw";
import { normalizePianoNotes, pianoPitchRange, pianoRollFrame, PIANO_ROLL_VIEW } from "./geometry";

const color = (style, name, fallback) => style.getPropertyValue(name).trim() || fallback;
const PixiPianoRoll = lazy(() => import("./pixi-scene"));

function PianoRoll({
  notes = [],
  currentTime = 0,
  currentTimeRef,
  isPlaying = false,
  sungMidi = null,
  isPitchDetected = false,
  keyShift = 0
}) {
  const rootRef = useRef(null);
  const canvasRef = useRef(null);
  const [size, setSize] = useState(PIANO_ROLL_VIEW);
  const [palette, setPalette] = useState({
    highlight: "#fff",
    hover: "#ff6b86",
    primary: "#ff174f",
    success: "#32e9a0",
    text: "#fff"
  });
  const usePixi = typeof globalThis.WebGLRenderingContext === "function";
  const normalized = useMemo(
    () => normalizePianoNotes(notes, Number(keyShift) || 0),
    [keyShift, notes]
  );
  const sung = Number(sungMidi);
  // The draw loop below runs on every animation frame while playing, so the
  // pitch range (a full min/max scan over every note) is computed here once
  // per actual notes/pitch change instead of once per frame inside
  // pianoRollFrame -- see the comment on pianoRollFrame for why that matters.
  const pitchRange = useMemo(() => pianoPitchRange(normalized, sung), [normalized, sung]);
  const frame = useMemo(
    () =>
      pianoRollFrame(
        normalized,
        Number(currentTimeRef?.current ?? currentTime) || 0,
        size,
        pitchRange
      ),
    [currentTime, currentTimeRef, normalized, pitchRange, size]
  );
  const draw = useCallback(
    (time) => {
      const canvas = canvasRef.current;
      const context = canvas?.getContext?.("2d");
      if (!canvas || !context) return;
      const ratio = globalThis.devicePixelRatio || 1;
      if (
        canvas.width !== Math.round(size.width * ratio) ||
        canvas.height !== Math.round(size.height * ratio)
      ) {
        canvas.width = Math.round(size.width * ratio);
        canvas.height = Math.round(size.height * ratio);
      }
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawPianoRoll(context, pianoRollFrame(normalized, time, size, pitchRange), palette, {
        detected: isPitchDetected,
        midi: sung
      });
    },
    [isPitchDetected, normalized, palette, pitchRange, size, sung]
  );

  useLayoutEffect(
    () => draw(Number(currentTimeRef?.current ?? currentTime) || 0),
    [currentTime, currentTimeRef, draw]
  );
  useEffect(() => {
    const root = rootRef.current;
    if (!root || typeof ResizeObserver === "undefined") return undefined;
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect;
      if (width && height) setSize({ width, height });
    });
    observer.observe(root);
    return () => observer.disconnect();
  }, []);
  useLayoutEffect(() => {
    const style = getComputedStyle(rootRef.current);
    setPalette({
      highlight: color(style, "--color-highlight", "#fff"),
      hover: color(style, "--color-primary-hover", "#ff6b86"),
      primary: color(style, "--color-primary", "#ff174f"),
      success: color(style, "--color-success", "#32e9a0"),
      text: color(style, "--color-text", "#fff")
    });
  }, []);
  useEffect(() => {
    if (!isPlaying || !currentTimeRef) return undefined;
    let animation;
    const render = () => {
      draw(Number(currentTimeRef.current) || 0);
      animation = requestAnimationFrame(render);
    };
    animation = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animation);
  }, [currentTimeRef, draw, isPlaying]);

  return (
    <Box
      ref={rootRef}
      data-role="melody-roll"
      data-current-midi={frame.notes.find(({ state }) => state === "current")?.note}
      data-pitch-detected={isPitchDetected || undefined}
      sx={{
        position: "absolute",
        inset: "50% var(--space-4) 0",
        zIndex: 3,
        overflow: "hidden",
        background: "transparent",
        boxShadow: "none",
        backdropFilter: "none"
      }}
    >
      <Box
        data-role="piano-roll-canvas"
        role="img"
        aria-label={t("common.melodyNotes")}
        sx={{ position: "absolute", inset: 0 }}
      >
        {usePixi ? (
          <Suspense fallback={null}>
            <PixiPianoRoll
              currentTime={currentTime}
              currentTimeRef={isPlaying ? currentTimeRef : null}
              isPitchDetected={isPitchDetected}
              notes={normalized}
              palette={palette}
              size={size}
              sung={sung}
            />
          </Suspense>
        ) : (
          <Box
            as="canvas"
            ref={canvasRef}
            sx={{ display: "block", inlineSize: "100%", blockSize: "100%" }}
          />
        )}
      </Box>
      <Box
        sx={{
          position: "absolute",
          inset: "0 auto 0 0",
          inlineSize: `${frame.keyboard}px`,
          pointerEvents: "none"
        }}
      >
        <PianoKeyboard
          height={frame.height}
          maxMidi={frame.max}
          minMidi={frame.min}
          rowHeight={frame.rowHeight}
          width={frame.keyboard}
        />
      </Box>
    </Box>
  );
}

export default memo(PianoRoll, (previous, next) => {
  if (
    previous.notes !== next.notes ||
    previous.currentTimeRef !== next.currentTimeRef ||
    previous.isPlaying !== next.isPlaying ||
    previous.sungMidi !== next.sungMidi ||
    previous.isPitchDetected !== next.isPitchDetected ||
    previous.keyShift !== next.keyShift
  )
    return false;
  return (
    Boolean(next.isPlaying && next.currentTimeRef) || previous.currentTime === next.currentTime
  );
});
