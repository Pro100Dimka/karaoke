import { Box, pianoNoteName } from "../../../theme/ui";

export default function Note({ c, note, highlighted }) {
  const selected = c.selected.includes(note._id);
  return (
    <Box
      as="button"
      type="button"
      data-role="editor-note"
      data-selected={selected || undefined}
      data-word-highlighted={highlighted || undefined}
      aria-label={`${pianoNoteName(note.note)} · ${note.start.toFixed(3)}–${note.end.toFixed(3)}`}
      onPointerDown={(e) => c.startDrag(e, note)}
      sx={{
        position: "absolute",
        top: (c.maxMidi - note.note + 0.12) * c.rowHeight,
        left: c.keyboardWidth + note.start * c.zoom,
        width: Math.max(c.rowHeight / 2, (note.end - note.start) * c.zoom),
        height: c.rowHeight * 0.76,
        padding: 0,
        borderRadius: "var(--shape-round)",
        border: highlighted
          ? "calc(var(--hairline) * 2) solid var(--color-warning)"
          : "var(--hairline) solid var(--color-highlight)",
        background: selected
          ? "linear-gradient(var(--color-highlight), var(--color-primary-hover))"
          : "linear-gradient(var(--color-primary-hover), var(--color-primary))",
        boxShadow: selected
          ? "0 0 var(--space-3) var(--color-primary)"
          : highlighted
            ? "0 0 var(--space-3) var(--color-warning)"
            : "0 0 var(--space-1) color-mix(in srgb,var(--color-primary) 45%,transparent)",
        cursor: "grab",
        touchAction: "none",
        zIndex: selected || highlighted ? 5 : 4
      }}
    >
      {["left", "right"].map((side) => (
        <Box
          as="span"
          key={side}
          aria-hidden
          onPointerDown={(e) => c.startDrag(e, note, side)}
          sx={{
            position: "absolute",
            insetBlock: 0,
            [side]: 0,
            width: "20%",
            cursor: "ew-resize"
          }}
        />
      ))}
    </Box>
  );
}
