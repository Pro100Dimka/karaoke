import { lazy, memo, Suspense, useLayoutEffect, useMemo, useRef, useState } from "react";
import { translateSaved as t } from "../../../../i18n/runtime";
import { Box, PianoKeyboard } from "../../../../theme/ui";
import { drawPianoRoll } from "./draw";
import { normalizePianoNotes, PIANO_ROLL_VIEW, pianoPitchRange, pianoRollFrame } from "./geometry";

const PixiPianoRoll = lazy(() => import("./pixi-scene"));
const USE_PIXI = typeof globalThis.WebGLRenderingContext === "function";
const COLORS = {
  highlight: ["--color-highlight", "#fff"],
  hover: ["--color-primary-hover", "#ff6b86"],
  primary: ["--color-primary", "#ff174f"],
  success: ["--color-success", "#32e9a0"],
  text: ["--color-text", "#fff"]
};
const paletteOf = (style) =>
  Object.fromEntries(
    Object.entries(COLORS).map(([key, [name, fallback]]) => [
      key,
      style?.getPropertyValue(name).trim() || fallback
    ])
  );
const timeOf = (ref, value = 0) => Number(ref?.current ?? value) || 0;
const midiOf = (value) => {
  if (value == null || value === "") return null;
  const midi = Number(value);
  return Number.isFinite(midi) ? midi : null;
};

function usePianoView(root) {
  const [view, setView] = useState(() => ({ size: PIANO_ROLL_VIEW, palette: paletteOf() }));

  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return;

    const setSize = ({ width, height }) => {
      if (!width || !height) return;
      setView((view) =>
        view.size.width === width && view.size.height === height
          ? view
          : { ...view, size: { width, height } }
      );
    };
    const setPalette = () =>
      setView((view) => ({ ...view, palette: paletteOf(globalThis.getComputedStyle?.(element)) }));

    setSize(element.getBoundingClientRect());
    setPalette();

    const resize = globalThis.ResizeObserver
      ? new ResizeObserver(([entry]) => setSize(entry.contentRect))
      : null;
    const theme = globalThis.MutationObserver ? new MutationObserver(setPalette) : null;
    resize?.observe(element);
    const documentRoot = globalThis.document?.documentElement;
    if (theme && documentRoot) {
      theme.observe(documentRoot, {
        attributes: true,
        attributeFilter: ["data-theme", "class", "style"]
      });
    }

    return () => {
      resize?.disconnect();
      theme?.disconnect();
    };
  }, [root]);

  return view;
}

function PianoRoll({
  notes = [],
  currentTime = 0,
  currentTimeRef,
  isPlaying = false,
  sungMidi,
  isPitchDetected = false,
  keyShift = 0
}) {
  const root = useRef(null);
  const canvas = useRef(null);
  const view = usePianoView(root);
  const normalized = useMemo(() => normalizePianoNotes(notes, keyShift), [notes, keyShift]);
  const sung = midiOf(sungMidi);
  const range = useMemo(() => pianoPitchRange(normalized, sung), [normalized, sung]);
  const frame = useMemo(
    () => pianoRollFrame(normalized, timeOf(currentTimeRef, currentTime), view.size, range),
    [normalized, currentTime, currentTimeRef, view.size, range]
  );

  useLayoutEffect(() => {
    if (USE_PIXI) return;
    const element = canvas.current;
    const context = element?.getContext("2d");
    if (!context) return;

    const draw = (time) => {
      const ratio = globalThis.devicePixelRatio || 1;
      const width = Math.round(view.size.width * ratio);
      const height = Math.round(view.size.height * ratio);
      if (element.width !== width) element.width = width;
      if (element.height !== height) element.height = height;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
      drawPianoRoll(
        context,
        pianoRollFrame(normalized, time, view.size, range),
        view.palette,
        { detected: isPitchDetected, midi: sung }
      );
    };

    draw(timeOf(currentTimeRef, currentTime));
    if (!isPlaying || !currentTimeRef || !globalThis.requestAnimationFrame) return;

    let animation;
    const render = () => {
      draw(timeOf(currentTimeRef));
      animation = requestAnimationFrame(render);
    };
    animation = requestAnimationFrame(render);
    return () => cancelAnimationFrame(animation);
  }, [normalized, range, view, sung, isPitchDetected, isPlaying, currentTime, currentTimeRef]);

  return (
    <Box
      ref={root}
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
        {USE_PIXI ? (
          <Suspense fallback={null}>
            <PixiPianoRoll
              notes={normalized}
              size={view.size}
              palette={view.palette}
              sung={sung}
              isPitchDetected={isPitchDetected}
              currentTime={currentTime}
              currentTimeRef={isPlaying ? currentTimeRef : null}
            />
          </Suspense>
        ) : (
          <Box as="canvas" ref={canvas} sx={{ display: "block", width: "100%", height: "100%" }} />
        )}
      </Box>
      <Box sx={{ position: "absolute", inset: "0 auto 0 0", width: frame.keyboard, pointerEvents: "none" }}>
        <PianoKeyboard
          height={frame.height}
          minMidi={frame.min}
          maxMidi={frame.max}
          rowHeight={frame.rowHeight}
          width={frame.keyboard}
        />
      </Box>
    </Box>
  );
}

export default memo(
  PianoRoll,
  (prev, next) =>
    prev.notes === next.notes &&
    prev.currentTimeRef === next.currentTimeRef &&
    prev.isPlaying === next.isPlaying &&
    prev.sungMidi === next.sungMidi &&
    prev.isPitchDetected === next.isPitchDetected &&
    prev.keyShift === next.keyShift &&
    (!!(next.isPlaying && next.currentTimeRef) || prev.currentTime === next.currentTime)
);
