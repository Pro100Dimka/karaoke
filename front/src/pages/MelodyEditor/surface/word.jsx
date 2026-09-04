import { Box, Typography } from "../../../theme/ui";

export default function Word({ c, word }) {
  const selected = c.selectedWords?.includes(word.index);
  const x = (time) => c.keyboardWidth + time * c.zoom;
  return (
    <>
      <Typography
        as="button"
        type="button"
        variant="caption"
        data-role="editor-word"
        data-selected={selected || undefined}
        title={`${word.text} · ${word.start.toFixed(3)}–${word.end.toFixed(3)}`}
        onClick={(e) => c.selectWord(word.index, e)}
        sx={{
          position: "absolute",
          top: "var(--space-1)",
          left: x(word.start),
          width: Math.max(c.rowHeight, (word.end - word.start) * c.zoom),
          overflow: "hidden",
          whiteSpace: "nowrap",
          padding: 0,
          border: 0,
          borderBottom: `calc(var(--hairline) * 2) solid var(--color-${
            selected ? "highlight" : "primary"
          })`,
          background: selected
            ? "color-mix(in srgb,var(--color-highlight) 30%,transparent)"
            : "transparent",
          color: "var(--color-text)",
          font: "inherit",
          fontWeight: 800,
          textAlign: "center",
          textShadow: "0 1px var(--space-1) var(--color-bg-deep)",
          cursor: "pointer"
        }}
      >
        {word.text}
      </Typography>

      {["left", "right"].map((side) => (
        <Box
          as="span"
          key={side}
          aria-hidden
          onPointerDown={(e) => c.startWordResize(e, word.index, side)}
          onClick={(e) => e.stopPropagation()}
          sx={{
            position: "absolute",
            top: "var(--space-1)",
            bottom: 0,
            left: x(side === "left" ? word.start : word.end) - (side === "right" ? 6 : 0),
            width: 6,
            cursor: "ew-resize",
            zIndex: 4
          }}
        />
      ))}
    </>
  );
}
