import { Grid, IconButton, Stack } from "../../../../theme/ui";
import { getControls, getMetrics } from "../../constants";
import { noteRangeLabel } from "../utils";
import Metric from "./metric";

export default function ConsoleCenter({
  song,
  currentTempo,
  compactKey,
  keyShift,
  onTempoChange,
  onKeyShiftChange,
  isPlaying,
  onSkip,
  onTogglePlay,
  onStop
}) {
  const shift = Number(keyShift) || 0;
  const controls = getControls(isPlaying, onSkip, onTogglePlay, onStop);
  const metrics = getMetrics(
    currentTempo,
    compactKey,
    noteRangeLabel,
    song,
    shift,
    onTempoChange,
    onKeyShiftChange
  );
  return (
    <Stack align="center" justify="space-between" gap="var(--space-2)">
      <Stack direction="row" align="center" justify="center" gap="var(--space-2)">
        {controls.map(([icon, label, onClick, variant, iconSize]) => (
          <IconButton
            key={label}
            icon={icon}
            label={label}
            variant={variant}
            iconSize={iconSize}
            onClick={onClick}
          />
        ))}
      </Stack>

      <Grid columns={metrics.length} gap="var(--space-2)">
        {metrics.map((metric) => (
          <Metric key={metric.label} {...metric} />
        ))}
      </Grid>
    </Stack>
  );
}
