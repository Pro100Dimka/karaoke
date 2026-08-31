import { Mic2, Music2 } from "lucide-react";
import { translateSaved as tr } from "../../../i18n/runtime";
import { Stack, Typography } from "../../../theme/ui";
import LibraryActions from "./actions";
import StatCard from "./stat-card";

const STAT_CARDS = [
  [Music2, "songCount", () => tr("library.totalSongs")],
  [Mic2, "readyCount", () => tr("library.readyForKaraoke")]
];

export default function LibraryHero({ songCount, readyCount, ...actions }) {
  const stats = { songCount, readyCount };
  const columnSx = { width: "auto", flex: "1 1 40%", minInlineSize: "40%" };
  const HERO_TEXT = [
    ["h5", "library.yourMusicCollection"],
    ["h1", "library.songLibrary"],
    ["h5", "library.addTracksControlProcessingAndOpenThemInKaraoke"]
  ];
  return (
    <Stack gap="var(--space-16)" py="var(--space-16)">
      <Stack direction="row" gap="var(--space-8)" wrap align="center">
        <Stack direction="row" align="center" gap="var(--space-5)" sx={columnSx}>
          <img
            alt=""
            aria-hidden
            src={getComputedStyle(document.documentElement)
              .getPropertyValue("--app-icon-image")
              .replace(/^url\(["']?|["']?\)$/g, "")}
            style={{
              width: "12%",
              objectFit: "contain",
              filter:
                "drop-shadow(0 0 var(--space-5) color-mix(in srgb, var(--ui-primary) 28%, transparent))"
            }}
          />
          <Stack gap="1rem">
            {HERO_TEXT.map(([variant, text]) => (
              <Typography
                key={text}
                variant={variant}
                tone={variant === "h5" ? "muted" : undefined}
              >
                {tr(text)}
              </Typography>
            ))}
          </Stack>
        </Stack>
        {STAT_CARDS.map(([Icon, key, label]) => (
          <StatCard key={key} Icon={Icon} value={stats[key]} label={label()} />
        ))}
      </Stack>
      <Stack direction="row" justify="end">
        <LibraryActions {...actions} />
      </Stack>
    </Stack>
  );
}
