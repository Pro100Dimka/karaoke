import { memo, useCallback, useLayoutEffect, useRef, useState } from "react";
import { translateSaved as t } from "../../i18n/runtime";
import { Box, PianoKeyboard, pianoNoteName, StudioScrollbars, Typography } from "../../theme/ui";

function NoteHitTarget({ controller, note }) {
  const selected = controller.selected.includes(note._id);
  const top = (controller.maxMidi - note.note) * controller.rowHeight;
  const left = controller.keyboardWidth + note.start * controller.zoom;
  const width = Math.max(controller.rowHeight / 2, (note.end - note.start) * controller.zoom);
  return (
    <Box
      as="button"
      type="button"
      data-role="editor-note"
      data-selected={selected || undefined}
      aria-label={`${pianoNoteName(note.note)} · ${note.start.toFixed(3)}–${note.end.toFixed(3)}`}
      onPointerDown={(event) => controller.startDrag(event, note)}
      sx={{
        position: "absolute",
        inset: `${top + controller.rowHeight * 0.12}px auto auto ${left}px`,
        inlineSize: `${width}px`,
        blockSize: `${controller.rowHeight * 0.76}px`,
        padding: 0,
        border: "var(--hairline) solid var(--color-highlight)",
        borderRadius: "var(--shape-round)",
        background: selected
          ? "linear-gradient(var(--color-highlight), var(--color-primary-hover))"
          : "linear-gradient(var(--color-primary-hover), var(--color-primary))",
        boxShadow: selected
          ? "0 0 var(--space-3) var(--color-primary)"
          : "0 0 var(--space-1) color-mix(in srgb, var(--color-primary) 45%, transparent)",
        cursor: "grab",
        touchAction: "none",
        zIndex: selected ? 5 : 4
      }}
    >
      {["left", "right"].map((side) => (
        <Box
          as="span"
          key={side}
          aria-hidden="true"
          onPointerDown={(event) => controller.startDrag(event, note, side)}
          sx={{
            position: "absolute",
            inset: `0 ${side === "right" ? 0 : "auto"} 0 ${side === "left" ? 0 : "auto"}`,
            inlineSize: "20%",
            cursor: "ew-resize"
          }}
        />
      ))}
    </Box>
  );
}

function EditorScrollbars({ controller }) {
  const frameRef = useRef(0);
  const [scrollState, setScrollState] = useState({
    clientHeight: 1,
    clientWidth: 1,
    scrollHeight: 1,
    scrollLeft: 0,
    scrollTop: 0,
    scrollWidth: 1
  });
  const syncScroll = useCallback(() => {
    const shell = controller.shellRef.current;
    if (!shell) return;
    cancelAnimationFrame(frameRef.current);
    frameRef.current = requestAnimationFrame(() => {
      const next = {
        clientHeight: shell.clientHeight,
        clientWidth: shell.clientWidth,
        scrollHeight: shell.scrollHeight,
        scrollLeft: shell.scrollLeft,
        scrollTop: shell.scrollTop,
        scrollWidth: shell.scrollWidth
      };
      setScrollState((current) =>
        Object.keys(next).every((key) => current[key] === next[key]) ? current : next
      );
    });
  }, [controller.shellRef]);
  useLayoutEffect(() => {
    syncScroll();
    const shell = controller.shellRef.current;
    if (!shell || !globalThis.ResizeObserver) return undefined;
    const observer = new globalThis.ResizeObserver(syncScroll);
    shell.addEventListener("scroll", syncScroll, { passive: true });
    observer.observe(shell);
    if (controller.surfaceRef.current) observer.observe(controller.surfaceRef.current);
    return () => {
      cancelAnimationFrame(frameRef.current);
      shell.removeEventListener("scroll", syncScroll);
      observer.disconnect();
    };
  }, [
    controller.laneHeight,
    controller.laneWidth,
    controller.shellRef,
    controller.surfaceRef,
    syncScroll
  ]);
  return (
    <StudioScrollbars
      keyboardWidth={controller.keyboardWidth}
      scrollRef={controller.shellRef}
      scrollState={scrollState}
      sync={syncScroll}
      horizontalZoom={controller.zoom}
      verticalZoom={controller.rowHeight}
      onHorizontalZoom={controller.setZoom}
      onVerticalZoom={controller.setRowHeight}
    />
  );
}

function EditorSurface({ controller, transport }) {
  useLayoutEffect(() => {
    if (!controller.playheadRef.current) return;
    controller.playheadRef.current.style.transform = `translate3d(${transport.timeRef.current * controller.zoom}px, 0, 0) translateX(-50%)`;
  }, [controller.playheadRef, controller.zoom, transport.timeRef]);

  return (
    <Box sx={{ position: "relative", flex: 1, minBlockSize: 0, overflow: "hidden" }}>
      <Box
        ref={controller.shellRef}
        data-role="editor-scroll-area"
        onWheel={(event) => {
          if (!event.ctrlKey) return;
          event.preventDefault();
          if (event.shiftKey)
            controller.setZoom((value) => Math.max(36, Math.min(600, value - event.deltaY * 0.2)));
          else
            controller.setRowHeight((value) =>
              Math.max(10, Math.min(36, value - event.deltaY * 0.02))
            );
        }}
        sx={{
          position: "absolute",
          inset: 0,
          overflow: "auto",
          scrollbarWidth: "none",
          background: "var(--color-bg-deep)"
        }}
      >
        <Box
          ref={controller.surfaceRef}
          data-role="editor-surface"
          onPointerDown={controller.startMarquee}
          onPointerMove={controller.movePointer}
          onPointerUp={controller.endPointer}
          onPointerCancel={controller.endPointer}
          onDoubleClick={(event) => {
            const rect = event.currentTarget.getBoundingClientRect();
            transport.seek(
              (event.clientX - rect.left - controller.keyboardWidth) / controller.zoom
            );
          }}
          sx={{
            position: "relative",
            inlineSize: `${controller.laneWidth}px`,
            blockSize: `${controller.laneHeight}px`,
            backgroundColor: "color-mix(in srgb, var(--color-bg-deep) 94%, var(--color-primary))",
            backgroundImage:
              "linear-gradient(90deg, color-mix(in srgb, var(--color-primary) 10%, transparent) 1px, transparent 1px), linear-gradient(180deg, color-mix(in srgb, var(--color-primary) 13%, transparent) 1px, transparent 1px)",
            backgroundSize: `${controller.zoom}px 100%, 100% ${controller.rowHeight}px`,
            touchAction: "none",
            userSelect: "none"
          }}
        >
          <Box
            sx={{
              position: "sticky",
              inset: "auto auto auto 0",
              zIndex: 8,
              inlineSize: `${controller.keyboardWidth}px`,
              blockSize: 0
            }}
          >
            <PianoKeyboard
              auditionNote={transport.tone}
              height={controller.laneHeight}
              maxMidi={controller.maxMidi}
              minMidi={controller.minMidi}
              rowHeight={controller.rowHeight}
              width={controller.keyboardWidth}
            />
          </Box>
          <Box
            aria-label={t("Слова песни")}
            sx={{
              position: "sticky",
              inset: "0 0 auto",
              zIndex: 3,
              blockSize: `${controller.rowHeight * 1.45}px`,
              borderBlockEnd: "1px solid color-mix(in srgb, var(--color-primary) 20%, transparent)",
              background: "color-mix(in srgb, var(--color-bg-deep) 82%, transparent)",
              backdropFilter: "blur(var(--space-1))"
            }}
          >
            {controller.words.map((word) => (
              <Typography
                key={word.index}
                as="span"
                variant="caption"
                title={`${word.text} · ${word.start.toFixed(3)}–${word.end.toFixed(3)}`}
                sx={{
                  position: "absolute",
                  inset: `var(--space-1) auto auto ${controller.keyboardWidth + word.start * controller.zoom}px`,
                  inlineSize: `${Math.max(controller.rowHeight, (word.end - word.start) * controller.zoom)}px`,
                  overflow: "hidden",
                  whiteSpace: "nowrap",
                  color: "var(--color-text)",
                  fontWeight: 800,
                  textAlign: "center",
                  textShadow: "0 1px var(--space-1) var(--color-bg-deep)",
                  borderBlockEnd: "calc(var(--hairline) * 2) solid var(--color-primary)"
                }}
              >
                {word.text}
              </Typography>
            ))}
          </Box>
          {controller.notes.map((note) => (
            <NoteHitTarget key={note._id} controller={controller} note={note} />
          ))}
          {controller.selectionBox && (
            <Box
              aria-hidden="true"
              sx={{
                position: "absolute",
                inset: `${Math.min(controller.selectionBox.y1, controller.selectionBox.y2)}px auto auto ${Math.min(controller.selectionBox.x1, controller.selectionBox.x2)}px`,
                inlineSize: `${Math.abs(controller.selectionBox.x2 - controller.selectionBox.x1)}px`,
                blockSize: `${Math.abs(controller.selectionBox.y2 - controller.selectionBox.y1)}px`,
                border: "1px solid var(--color-highlight)",
                background: "color-mix(in srgb, var(--color-primary) 18%, transparent)",
                pointerEvents: "none",
                zIndex: 7
              }}
            />
          )}
          <Box
            ref={controller.playheadRef}
            data-role="editor-playhead"
            role="slider"
            aria-label={t("Позиция воспроизведения")}
            aria-valuemin={0}
            aria-valuemax={controller.duration}
            aria-valuenow={transport.timeRef.current}
            tabIndex={0}
            onPointerDown={(event) => {
              event.stopPropagation();
              event.currentTarget.setPointerCapture?.(event.pointerId);
              const rect = controller.surfaceRef.current.getBoundingClientRect();
              transport.seek(
                (event.clientX - rect.left - controller.keyboardWidth) / controller.zoom
              );
            }}
            onPointerMove={(event) => {
              if (!event.currentTarget.hasPointerCapture?.(event.pointerId)) return;
              const rect = controller.surfaceRef.current.getBoundingClientRect();
              transport.seek(
                (event.clientX - rect.left - controller.keyboardWidth) / controller.zoom
              );
            }}
            onKeyDown={(event) => {
              if (!["ArrowLeft", "ArrowRight"].includes(event.key)) return;
              event.preventDefault();
              transport.seek(
                transport.timeRef.current + (event.key === "ArrowRight" ? 0.05 : -0.05)
              );
            }}
            sx={{
              position: "absolute",
              inset: `0 auto 0 ${controller.keyboardWidth}px`,
              inlineSize: "var(--space-3)",
              transform: "translateX(-50%)",
              borderInlineStart: "calc(var(--hairline) * 2) solid var(--color-primary-hover)",
              filter: "drop-shadow(0 0 var(--space-2) var(--color-primary))",
              cursor: "ew-resize",
              touchAction: "none",
              zIndex: 6
            }}
          />
        </Box>
      </Box>
      <EditorScrollbars controller={controller} />
    </Box>
  );
}

const SURFACE_KEYS = [
  "keyboardWidth",
  "duration",
  "laneHeight",
  "laneWidth",
  "maxMidi",
  "minMidi",
  "notes",
  "rowHeight",
  "selected",
  "selectionBox",
  "words",
  "zoom"
];

export default memo(
  EditorSurface,
  (previous, next) =>
    SURFACE_KEYS.every((key) => previous.controller[key] === next.controller[key]) &&
    previous.transport.seek === next.transport.seek &&
    previous.transport.tone === next.transport.tone
);
