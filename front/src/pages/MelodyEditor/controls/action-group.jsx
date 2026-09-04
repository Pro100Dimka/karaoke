import { IconButton, Stack, Tooltip } from "../../../theme/ui";

export default function ActionGroup({ color, actions }) {
  return (
    <Stack
      direction="row"
      align="center"
      gap="var(--space-1)"
      sx={{
        inlineSize: "auto",
        padding: "var(--space-1)",
        border: `1px solid color-mix(in srgb, ${color} 42%, transparent)`,
        borderRadius: "var(--radius-pill)",
        background: "var(--color-bg-deep)"
      }}
    >
      {actions.map(([Icon, label, onClick, active, disabled, tone]) => (
        <Tooltip key={label} title={label}>
          <IconButton
            unstyled
            icon={Icon}
            label={label}
            tone={tone}
            iconSize={18}
            onClick={onClick}
            disabled={disabled}
            aria-pressed={active || undefined}
            sx={{
              display: "inline-flex",
              placeItems: "center",
              inlineSize: "var(--space-10)",
              blockSize: "var(--space-10)",
              minInlineSize: "var(--space-10)",
              padding: 0,
              border: `1px solid color-mix(in srgb, ${color} 68%, transparent)`,
              borderRadius: "50%",
              color,
              background: active
                ? `color-mix(in srgb, ${color} 18%, var(--color-bg-deep))`
                : "var(--color-bg-deep)",
              boxShadow: `0 0 var(--space-3) color-mix(in srgb, ${color} ${active ? 42 : 18}%, transparent)`,
              opacity: disabled ? 0.26 : 1
            }}
          />
        </Tooltip>
      ))}
    </Stack>
  );
}
