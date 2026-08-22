import { Mic2, Music2, Sparkles } from "lucide-react";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Box, Card, Stack, Typography } from "../../../theme/ui";
import LibraryActions from "./actions";

const STAT_CARDS = [
  [Music2, "songCount", () => tr("всего песен")],
  [Mic2, "readyCount", () => tr("готово к караоке")]
];
export default function LibraryHero({ songCount, readyCount, ...actions }) {
  const values = { songCount, readyCount };
  return (
    <Stack
      sx={{ paddingBlock: "var(--space-16)" }}
      justify="space-between"
      direction="row"
      wrap
      align="start"
    >
      <Stack direction="row" align="center" gap="var(--space-5)" sx={{ width: "50%" }}>
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
      <Stack direction="row" gap="3rem" wrap justify="end" sx={{ width: "25%", height: "stretch" }}>
        <Stack direction="row" gap="var(--space-4)" wrap>
          {STAT_CARDS.map(([Icon, key, getLabel]) => (
            <Card
              key={key}
              variant="laser"
              tilt={false}
              sx={{ containerType: "normal", flex: 1 }}
              cardContent={{
                style: {
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "flex-start",
                  gap: "var(--space-5)",
                  padding: "var(--space-6) var(--space-6)"
                }
              }}
            >
              <Box
                aria-hidden="true"
                sx={{
                  position: "relative",
                  color: "var(--ui-primary)",
                  padding: "var(--space-3)"
                }}
              >
                <Icon />
                <Sparkles style={{ position: "absolute", inset: "auto auto 70% 70%" }} />
              </Box>
              <Stack gap="var(--space-1)">
                <Typography variant="h3">{values[key]}</Typography>
                <Typography variant="body2" tone="muted">
                  {getLabel()}
                </Typography>
              </Stack>
            </Card>
          ))}
        </Stack>
      </Stack>
      <Stack direction="row" align="center" justify="end" sx={{ paddingTop: "var(--space-16)" }}>
        <LibraryActions {...actions} />
      </Stack>
    </Stack>
  );
}
