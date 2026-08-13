import { Mic } from "lucide-react";

import { api } from "../../../api/client";
import { POLLING_INTERVALS } from "../../../config/runtime";
import { usePolling } from "../../../hooks/usePolling";
import { useI18n } from "../../../i18n";
import { Grid, Stack, Typography } from "../../../theme/ui";
import { APP_INFO } from "../../../utils/config";

const INFO_FIELDS = [
  ["backend_version", "backendVersion"],
  ["frontend_version", "frontendVersion"],
  ["ai_version", "aiVersion"],
  ["data_dir", "dataPath"]
];

export default function About() {
  const { t } = useI18n();
  const { data } = usePolling(api.getAbout, POLLING_INTERVALS.about, []);
  const about = data ?? {};

  return (
    <Stack align="center" gap={1.4} className="settings-about-screen">
      <div className="settings-about-icon" aria-hidden="true">
        <Mic size={34} />
      </div>

      <Stack align="center" gap={0.35}>
        <Typography variant="h2" align="center">
          {APP_INFO.title}
        </Typography>

        <Typography variant="body2" tone="muted" align="center">
          {t("settings.about.description")}
        </Typography>
      </Stack>

      <Grid
        columns={2}
        gap="0"
        className="settings-about-info"
        sx={{ width: "100%", maxWidth: "56rem" }}
      >
        {INFO_FIELDS.map(([key, label]) => (
          <Stack key={key} gap={0.25} className="settings-about-info-item">
            <Typography variant="caption" tone="muted">
              {t(`settings.about.${label}`)}
            </Typography>

            <Typography
              variant="body2"
              className="mono"
              sx={{ overflowWrap: "anywhere" }}
            >
              {about[key] ?? "—"}
            </Typography>
          </Stack>
        ))}
      </Grid>

      <Typography variant="caption" tone="muted" align="center">
        {APP_INFO.copyright}
      </Typography>
    </Stack>
  );
}
