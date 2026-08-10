import { api } from "../../../../api/client";
import Table from "../../../../components/table";
import { useAppDialog } from "../../../../contexts/AppDialog";
import { usePolling } from "../../../../hooks/usePolling";
import { Button, Card, Chip, Stack, Typography } from "../../../../theme/ui";
import { getErrorMessage } from "../../../../utils/errors";
import { ACTIONS, MODEL_COLUMNS, STATUSES } from "./config";
import { formatModelSize, runDialogAction } from "./utils";

export default function Models() {
  const { data: models, error } = usePolling(api.listWhisperModels, 4000, []);
  const dialogs = useAppDialog();

  return (
    <Card
      variant="animation"
      tilt={false}
      className="settings-screen-card"
      cardContent={{ style: { padding: "1.25rem" } }}
    >
      <Stack gap={1}>
        <Typography variant="h3">Модели AI — Whisper</Typography>

        {error && (
          <Typography variant="body2" sx={{ color: "var(--ui-danger)" }}>
            {getErrorMessage(error)}
          </Typography>
        )}

        <Table
          columns={MODEL_COLUMNS}
          data={models}
          getRowKey={(model) => model.name}
          renderRow={(model) => [
            [model.name, "models-name"],
            [formatModelSize(model), "text-muted mono"],
            [renderStatus(model)],
            [renderActions(model, dialogs)]
          ]}
          emptyText="Модели не найдены"
        />
      </Stack>
    </Card>
  );
}

function renderStatus(model) {
  const status = STATUSES.find(({ check }) => check(model));
  if (!status) return null;

  const tones = {
    selected: "success",
    downloaded: "primary",
    missing: "default"
  };

  return (
    <Chip size="sm" tone={tones[status.id] ?? "default"}>
      {status.text}
    </Chip>
  );
}

function renderActions(model, dialogs) {
  return (
    <Stack direction="row" gap={0.5} wrap>
      {ACTIONS.filter(({ visible }) => visible(model)).map((action) => {
        const Icon = action.icon;

        return (
          <Button
            key={action.id}
            variant={action.variant === "ghost" ? "outline" : "solid"}
            tone={action.variant === "danger" ? "danger" : "primary"}
            size="sm"
            aria-label={action.ariaLabel}
            title={action.ariaLabel}
            onClick={() => runDialogAction(action, model, dialogs)}
          >
            {Icon && <Icon size={14} />}
            {action.label}
          </Button>
        );
      })}
    </Stack>
  );
}
