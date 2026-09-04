import { CircleAlert } from "lucide-react";
import { translateSaved as tr } from "../../../../../i18n/runtime";
import { Button, Card, Stack, Typography } from "../../../../../theme/ui";
import * as platform from "../../../../../utils/platform";

export default ({ failure, stage, progress }) => {
  return (
    <Card
      role="alert"
      sx={{ padding: "var(--space-4)", border: "var(--hairline) solid var(--ui-danger)" }}
    >
      <Stack gap={0.75}>
        <Stack direction="row" align="center" gap={0.5}>
          <CircleAlert size={20} />
          <Typography sx={{ fontWeight: 800 }}>{tr("library.processingStopped")}</Typography>
        </Stack>
        <Typography tone="danger">{failure.reason}</Typography>
        <Stack direction="row" gap={0.75} wrap>
          {[
            ["library.errorType", failure.type],
            ["library.stage", stage || tr("library.notSpecified")],
            ["library.completed", `${Math.round(progress)}%`]
          ].map(([label, value]) => (
            <Card key={label} sx={{ flex: 1, padding: "var(--space-3)" }}>
              <Typography variant="caption" tone="muted">
                {tr(label)}
              </Typography>
              <Typography sx={{ fontWeight: 750, overflowWrap: "anywhere" }}>{value}</Typography>
            </Card>
          ))}
        </Stack>
        <Typography variant="body2" tone="muted">
          {failure.hint}
        </Typography>
        <Button variant="outlined" onClick={platform.openApplicationLog}>
          {tr("library.openExecutionLog")}
        </Button>
      </Stack>
    </Card>
  );
};
