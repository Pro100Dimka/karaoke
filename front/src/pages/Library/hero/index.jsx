import { Mic2, Music2 } from "lucide-react";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Stack, Typography } from "../../../theme/ui";
import LibraryActions from "./actions";
import StatCard from "./stat-card";

const TEXT = [
  ["h5", "library.yourMusicCollection"],
  ["h1", "library.songLibrary"],
  ["h5", "library.addTracksControlProcessingAndOpenThemInKaraoke"]
];
const STATS = [
  [Music2, "songCount", "library.totalSongs"],
  [Mic2, "readyCount", "library.readyForKaraoke"]
];
const column = { width: "auto", flex: "1 1 40%", minInlineSize: "40%" };

export default function LibraryHero({ songCount, readyCount, ...actions }) {
  const values = { songCount, readyCount };
  const icon = getComputedStyle(document.documentElement)
    .getPropertyValue("--app-icon-image")
    .replace(/^url\(["']?|["']?\)$/g, "");

  return (
    <Stack gap="var(--space-16)" py="var(--space-16)">
      <Stack direction="row" gap="var(--space-8)" wrap align="center">
        <Stack direction="row" align="center" gap="var(--space-5)" sx={column}>
          <img
            alt=""
            aria-hidden
            src={icon}
            style={{
              width: "12%",
              objectFit: "contain",
              filter:
                "drop-shadow(0 0 var(--space-5) color-mix(in srgb, var(--ui-primary) 28%, transparent))"
            }}
          />
          <Stack gap="1rem">
            {TEXT.map(([variant, key]) => (
              <Typography key={key} variant={variant} tone={variant === "h5" ? "muted" : undefined}>
                {tr(key)}
              </Typography>
            ))}
          </Stack>
        </Stack>

        {STATS.map(([Icon, key, label]) => (
          <StatCard key={key} Icon={Icon} value={values[key]} label={tr(label)} />
        ))}
      </Stack>

      <Stack direction="row" justify="end">
        <LibraryActions {...actions} />
      </Stack>
    </Stack>
  );
}
