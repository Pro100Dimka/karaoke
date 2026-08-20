import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import {
  anchoredHorizontalScroll,
  anchoredVerticalScroll,
  anchoredVerticalScrollToNote
} from "./melody-editor-geometry";
import { clamp } from "./melody-editor-state";

const INITIAL_SCROLL_STATE = Object.freeze({
  left: 0,
  top: 0,
  clientWidth: 1,
  clientHeight: 1,
  scrollWidth: 1,
  scrollHeight: 1
});

export default function useMelodyEditorViewport({
  duration,
  instrumentalRef,
  keyboardWidth,
  laneHeight,
  laneWidth,
  maxMidi,
  minMidi,
  notes,
  setVerticalZoom,
  setZoom,
  verticalZoom,
  zoom
}) {
  const rollShellRef = useRef(null);
  const rollCanvasRef = useRef(null);
  const scrollDragRef = useRef(null);
  const [scrollState, setScrollState] = useState(INITIAL_SCROLL_STATE);

  const syncScrollState = useCallback(() => {
    const shell = rollShellRef.current;
    if (!shell) return;
    setScrollState({
      left: shell.scrollLeft,
      top: shell.scrollTop,
      clientWidth: shell.clientWidth || 1,
      clientHeight: shell.clientHeight || 1,
      scrollWidth: shell.scrollWidth || 1,
      scrollHeight: shell.scrollHeight || 1
    });
  }, []);

  const startScrollThumbDrag = useCallback((event, axis) => {
    const shell = rollShellRef.current;
    if (!shell) return;
    event.preventDefault();
    event.stopPropagation();
    scrollDragRef.current = {
      axis,
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      left: shell.scrollLeft,
      top: shell.scrollTop,
      maxX: Math.max(0, shell.scrollWidth - shell.clientWidth),
      maxY: Math.max(0, shell.scrollHeight - shell.clientHeight),
      trackSize:
        axis === "x"
          ? event.currentTarget.parentElement?.clientWidth || 1
          : event.currentTarget.parentElement?.clientHeight || 1,
      thumbSize:
        axis === "x" ? event.currentTarget.clientWidth || 1 : event.currentTarget.clientHeight || 1
    };
    event.currentTarget.setPointerCapture?.(event.pointerId);
  }, []);

  const moveScrollThumbDrag = useCallback(
    (event) => {
      const state = scrollDragRef.current;
      const shell = rollShellRef.current;
      if (!state || !shell) return;
      event.preventDefault();
      const usable = Math.max(1, state.trackSize - state.thumbSize);
      if (state.axis === "x")
        shell.scrollLeft = clamp(
          state.left + ((event.clientX - state.x) / usable) * state.maxX,
          0,
          state.maxX
        );
      else
        shell.scrollTop = clamp(
          state.top + ((event.clientY - state.y) / usable) * state.maxY,
          0,
          state.maxY
        );
      syncScrollState();
    },
    [syncScrollState]
  );

  const endScrollThumbDrag = useCallback((event) => {
    if (!scrollDragRef.current) return;
    scrollDragRef.current = null;
    event.currentTarget.releasePointerCapture?.(event.pointerId);
  }, []);

  useEffect(() => {
    const frame = requestAnimationFrame(syncScrollState);
    return () => cancelAnimationFrame(frame);
  }, [laneHeight, laneWidth, syncScrollState]);

  const setHorizontalZoomAnchored = useCallback(
    (nextZoom) => {
      const shell = rollShellRef.current;
      const next = clamp(Number(nextZoom), 36, 600);
      if (!shell || next === zoom) {
        setZoom(next);
        return;
      }
      const anchorTime = instrumentalRef.current?.currentTime ?? 0;
      const nextScrollWidth = Math.max(
        shell.clientWidth,
        Math.max(1180, duration * next) + keyboardWidth
      );
      const nextLeft = anchoredHorizontalScroll({
        time: anchorTime,
        oldZoom: zoom,
        newZoom: next,
        keyboardWidth,
        scrollLeft: shell.scrollLeft,
        clientWidth: shell.clientWidth,
        scrollWidth: nextScrollWidth
      });
      flushSync(() => setZoom(next));
      shell.scrollLeft = nextLeft;
      rollCanvasRef.current?.style.setProperty(
        "--editor-playhead-x",
        `${keyboardWidth + anchorTime * next}px`
      );
      syncScrollState();
    },
    [duration, instrumentalRef, keyboardWidth, setZoom, syncScrollState, zoom]
  );

  const setVerticalZoomAnchored = useCallback(
    (nextZoom) => {
      const shell = rollShellRef.current;
      const next = clamp(Number(nextZoom), 10, 36);
      if (!shell || next === verticalZoom) {
        setVerticalZoom(next);
        return;
      }
      const viewportCenterY = shell.scrollTop + shell.clientHeight / 2;
      const anchorNote = notes.length
        ? notes.reduce((best, note) => {
            const y = (maxMidi - note.note + 0.5) * verticalZoom;
            const distance = Math.abs(y - viewportCenterY);
            return !best || distance < best.distance ? { note, distance } : best;
          }, null)
        : null;
      const nextTop = anchorNote
        ? anchoredVerticalScrollToNote({
            noteMidi: anchorNote.note.note,
            maxMidi,
            oldRowHeight: verticalZoom,
            newRowHeight: next,
            scrollTop: shell.scrollTop,
            clientHeight: shell.clientHeight,
            rowCount: maxMidi - minMidi + 1
          })
        : anchoredVerticalScroll({
            scrollTop: shell.scrollTop,
            clientHeight: shell.clientHeight,
            oldRowHeight: verticalZoom,
            newRowHeight: next,
            rowCount: maxMidi - minMidi + 1
          });
      flushSync(() => setVerticalZoom(next));
      shell.scrollTop = nextTop;
      syncScrollState();
    },
    [maxMidi, minMidi, notes, setVerticalZoom, syncScrollState, verticalZoom]
  );

  const handleRollWheel = useCallback(
    (event) => {
      event.preventDefault();
      event.stopPropagation();
      event.stopImmediatePropagation?.();
      const direction = event.deltaY < 0 ? 1 : -1;
      if (event.shiftKey) setHorizontalZoomAnchored(zoom + direction * 10);
      else setVerticalZoomAnchored(verticalZoom + direction);
    },
    [setHorizontalZoomAnchored, setVerticalZoomAnchored, verticalZoom, zoom]
  );

  useEffect(() => {
    const onWheel = (event) => {
      const shell = rollShellRef.current;
      if (!shell || !event.ctrlKey || !shell.contains(event.target)) return;
      handleRollWheel(event);
    };
    window.addEventListener("wheel", onWheel, { passive: false, capture: true });
    return () => window.removeEventListener("wheel", onWheel, { capture: true });
  }, [handleRollWheel]);

  return {
    endScrollThumbDrag,
    moveScrollThumbDrag,
    rollCanvasRef,
    rollShellRef,
    scrollState,
    setHorizontalZoomAnchored,
    setVerticalZoomAnchored,
    startScrollThumbDrag,
    syncScrollState
  };
}
