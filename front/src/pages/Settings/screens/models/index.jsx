import { api } from "../../../../api/client";
import Button from "../../../../components/fields/button";
import Table from "../../../../components/table";
import { Panel } from "../../../../components/ui";
import { useAppDialog } from "../../../../contexts/AppDialog";
import { usePolling } from "../../../../hooks/usePolling";
import { getErrorMessage } from "../../../../utils/errors";
import { ACTIONS, MODEL_COLUMNS, STATUSES } from "./config";
import { formatModelSize, runDialogAction } from "./utils";

export default function Models() {
  const { data: models, error } = usePolling(api.listWhisperModels, 4000, []);
  const dialogs = useAppDialog();
  return (
    <Panel title="Модели AI — Whisper">
      {error && <p className="text-danger">{getErrorMessage(error)}</p>}
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
    </Panel>
  );
}

function renderStatus(model) {
  const status = STATUSES.find(({ check }) => check(model));
  if (!status) return null;
  const { className, text } = status;
  return (
    <span className={className}>
      {className.includes("badge") && <span className="badge-dot" />}
      {text}
    </span>
  );
}

function renderActions(model, dialogs) {
  return (
    <div className="models-actions">
      {ACTIONS.filter(({ visible }) => visible(model)).map((action) => (
        <Button
          key={action.id}
          icon={action.icon}
          variant={action.variant}
          aria-label={action.ariaLabel}
          title={action.ariaLabel}
          onClick={() => runDialogAction(action, model, dialogs)}
        >
          {action.label}
        </Button>
      ))}
    </div>
  );
}
