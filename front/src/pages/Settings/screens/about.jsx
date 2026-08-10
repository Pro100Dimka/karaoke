import { Mic } from "lucide-react";

import { api } from "../../../api/client";
import { usePolling } from "../../../hooks/usePolling";
import { Card, Grid, Stack, Typography } from "../../../theme/ui";
import { APP_INFO } from "../../../utils/config";

const INFO_FIELDS = [
  ["backend_version", "Версия Backend"],
  ["frontend_version", "Версия React"],
  ["ai_version", "Версия AI"],
  ["data_dir", "Путь к данным"]
];

export default function About() {
  const { data } = usePolling(api.getAbout, 10000, []);
  const about = data ?? {};

  return (
    <Card
      variant="animation"
      tilt={false}
      className="settings-screen-card"
      cardContent={{ style: { padding: "1.5rem" } }}
    >
      <Stack align="center" gap={1.25}>
        <Card
          as="div"
          variant="animation"
          tilt={false}
          sx={{ width: "4.5rem", height: "4.5rem" }}
          cardContent={{
            style: {
              display: "grid",
              placeItems: "center"
            }
          }}
        >
          <Mic size={34} />
        </Card>

        <Stack align="center" gap={0.35}>
          <Typography variant="h2" align="center">
            {APP_INFO.title}
          </Typography>

          <Typography variant="body2" tone="muted" align="center">
            {APP_INFO.description}
          </Typography>
        </Stack>

        <Grid
          minItemWidth="min(100%, 19rem)"
          gap="var(--space-3)"
          sx={{ width: "100%", maxWidth: "56rem" }}
        >
          {INFO_FIELDS.map(([key, label]) => (
            <Card
              key={key}
              as="div"
              variant="animation"
              tilt={false}
              cardContent={{ style: { padding: "1rem 1.1rem" } }}
            >
              <Stack gap={0.35}>
                <Typography variant="caption" tone="muted">
                  {label}
                </Typography>

                <Typography
                  variant="body2"
                  className="mono"
                  sx={{ overflowWrap: "anywhere" }}
                >
                  {about[key] ?? "—"}
                </Typography>
              </Stack>
            </Card>
          ))}
        </Grid>

        <Typography variant="caption" tone="muted" align="center">
          {APP_INFO.copyright}
        </Typography>
      </Stack>
    </Card>
  );
}
