import { Box } from "../../../../theme/ui";

export default function AuroraWorld({ seed = 0 }) {
  const offset = Number(seed) % 100;
  return (
    <Box
      aria-hidden="true"
      data-role="aurora-world"
      sx={{
        position: "absolute",
        inset: 0,
        background: `radial-gradient(circle at ${20 + (offset % 30)}% 18%, color-mix(in srgb, var(--color-primary) 24%, transparent), transparent 30%), radial-gradient(circle at ${65 + (offset % 20)}% 28%, color-mix(in srgb, var(--color-secondary) 18%, transparent), transparent 34%), linear-gradient(180deg, transparent 48%, color-mix(in srgb, var(--color-bg-deep) 74%, transparent))`,
        mixBlendMode: "screen",
        pointerEvents: "none"
      }}
    />
  );
}
