import { Mic2, Music2, Sparkles } from "lucide-react";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Box, Card, Stack, Typography } from "../../../theme/ui";
import LibraryActions from "./actions";

const STAT_CARDS = [
  [Music2, "songCount", () => tr("всего песен")],
  [Mic2, "readyCount", () => tr("готово к караоке")]
];

const WAVE_POINTS =
  "0,24 8,24 12,20 16,28 20,16 24,32 28,22 32,26 36,12 40,36 44,20 48,28 52,8 56,40 60,18 64,30 68,14 72,34 76,22 80,26 84,18 88,30 92,10 96,38 100,20 104,28 108,16 112,32 116,22 120,26 124,18 128,30 132,14 136,34 140,22 144,26 148,20 152,28 160,24";

function StatCard({ Icon, label, value }) {
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
        aria-hidden="true"
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
        <Icon style={{ inlineSize: "var(--space-8)", blockSize: "var(--space-8)" }} />
        <Sparkles
          style={{
            position: "absolute",
            inset: "var(--space-2) var(--space-1) auto auto",
            inlineSize: "var(--space-5)",
            blockSize: "var(--space-5)"
          }}
        />
      </Box>
      <Stack gap="var(--space-1)" sx={{ flex: "none" }}>
        <Typography variant="h3">{value}</Typography>
        <Typography variant="body2" tone="muted">
          {label}
        </Typography>
      </Stack>
      <Box
        as="svg"
        aria-hidden="true"
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
          points={WAVE_POINTS}
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

export default function LibraryHero({ songCount, readyCount, ...actions }) {
  const values = { songCount, readyCount };
  return (
    <Stack gap="var(--space-16)" sx={{ paddingBlock: "var(--space-16)" }}>
      <Stack direction="row" gap="var(--space-8)" wrap align="center">
        <Stack
          direction="row"
          align="center"
          gap="var(--space-5)"
          sx={{ width: "auto", flex: "1 1 40%", minInlineSize: "40%" }}
        >
          <Box
            aria-hidden="true"
            sx={{
              aspectRatio: 1,
              flex: "none",
              padding: "var(--space-16)",
              background: "var(--app-icon-image) center / contain no-repeat",
              filter:
                "drop-shadow(0 0 var(--space-5) color-mix(in srgb, var(--ui-primary) 28%, transparent))"
            }}
          />
          <Stack gap="1rem">
            <Typography variant="h5" tone="muted">
              {tr("Ваша музыкальная коллекция")}
            </Typography>
            <Typography variant="h1">{tr("Библиотека песен")}</Typography>
            <Typography variant="h5" tone="muted">
              {tr("Добавляйте треки, управляйте обработкой и открывайте их в караоке.")}
            </Typography>
          </Stack>
        </Stack>
        <Stack
          direction="row"
          gap="var(--space-4)"
          wrap
          sx={{ width: "auto", flex: "1 1 40%", minInlineSize: "40%" }}
        >
          {STAT_CARDS.map(([Icon, key, getLabel]) => (
            <StatCard key={key} Icon={Icon} value={values[key]} label={getLabel()} />
          ))}
        </Stack>
      </Stack>
      <Stack direction="row" align="center" justify="end">
        <LibraryActions {...actions} />
      </Stack>
    </Stack>
  );
}
