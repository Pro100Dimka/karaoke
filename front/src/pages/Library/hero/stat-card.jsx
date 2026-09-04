import { Sparkles } from "lucide-react";
import { Box, Card, Stack, Typography } from "../../../theme/ui";

const WAVE =
  "0,24 8,24 12,20 16,28 20,16 24,32 28,22 32,26 36,12 40,36 44,20 48,28 52,8 56,40 60,18 64,30 68,14 72,34 76,22 80,26 84,18 88,30 92,10 96,38 100,20 104,28 108,16 112,32 116,22 120,26 124,18 128,30 132,14 136,34 140,22 144,26 148,20 152,28 160,24";

export default function StatCard({ Icon, label, value }) {
  return (
    <Card
      variant="laser"
      tilt={false}
      sx={{ containerType: "normal", flex: 1 }}
      cardContent={{
        style: {
          display: "flex",
          alignItems: "center",
          gap: "var(--space-5)",
          padding: "var(--space-5)"
        }
      }}
    >
      <Box
        aria-hidden
        sx={{
          position: "relative",
          display: "grid",
          placeItems: "center",
          flex: "none",
          aspectRatio: 1,
          padding: "var(--space-5)",
          border: "var(--hairline) solid var(--ui-primary)",
          borderRadius: "var(--shape-round)",
          color: "var(--ui-primary)",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--ui-primary) 16%, transparent), var(--color-bg-deep) 68%)",
          boxShadow:
            "inset 0 0 var(--space-4) color-mix(in srgb, var(--ui-primary) 16%, transparent), 0 0 var(--space-4) color-mix(in srgb, var(--ui-primary) 30%, transparent)"
        }}
      >
        <Icon size="var(--space-8)" />
        <Sparkles
          size="var(--space-5)"
          style={{ position: "absolute", inset: "var(--space-2) var(--space-1) auto auto" }}
        />
      </Box>

      <Stack gap="var(--space-1)" sx={{ flex: "none" }}>
        <Typography variant="h3">{value}</Typography>
        <Typography variant="body2" tone="muted">{label}</Typography>
      </Stack>

      <Box
        as="svg"
        aria-hidden
        viewBox="0 0 160 48"
        preserveAspectRatio="none"
        sx={{
          flex: 1,
          minInlineSize: 0,
          blockSize: "var(--space-10)",
          color: "var(--ui-primary)",
          overflow: "visible"
        }}
      >
        <polyline
          points={WAVE}
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          vectorEffect="non-scaling-stroke"
          style={{ filter: "drop-shadow(0 0 var(--space-1) currentColor)" }}
        />
      </Box>
    </Card>
  );
}
