import { Card, Grid, Stack } from "../../../theme/ui";
import ConsoleCenter from "./center";
import MixerPanel from "./mixer";
import SongStrip from "./song-strip";
import ToolsPanel from "./tools";

export default ({ autoHideEnabled, onAutoHideChange, visible = true, ...props }) => (
  <Card
    as="aside"
    data-role="karaoke-console"
    aria-hidden={!visible}
    variant="laser"
    tilt={false}
    cardPanel={{
      style: {
        background:
          "linear-gradient(90deg, color-mix(in srgb, var(--color-bg-deep) 78%, transparent), color-mix(in srgb, var(--color-surface) 88%, transparent))",
        backdropFilter: "blur(var(--space-3)) saturate(1.25)"
      }
    }}
    cardContent={{ style: { padding: 0 } }}
    sx={{
      position: "absolute",
      inset: "auto var(--space-2) var(--space-2)",
      zIndex: 12,
      opacity: +visible,
      transform: visible ? "none" : "translateY(var(--space-8))",
      pointerEvents: visible ? "auto" : "none",
      transition:
        "opacity var(--motion-duration-normal) var(--motion-easing-standard), transform var(--motion-duration-normal) var(--motion-easing-spring)"
    }}
  >
    <Stack gap="var(--space-1)">
      <SongStrip {...props} />
      <Grid
        columns={3}
        gap="var(--space-3)"
        sx={{ padding: "var(--space-1) var(--space-3) var(--space-2)", alignItems: "center" }}
      >
        <MixerPanel {...props} />
        <ConsoleCenter {...props} />
        <ToolsPanel
          {...props}
          autoHideEnabled={autoHideEnabled}
          onAutoHideChange={onAutoHideChange}
        />
      </Grid>
    </Stack>
  </Card>
);
