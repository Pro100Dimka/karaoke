import Button from "../../../../components/fields/button";
import { ACTIONS, STATUSES } from "./config";
import { formatModelSize, runDialogAction } from "./utils";

export default function ModelRow({ model, dialogs }) {
  const tableData = [
    [model.name, "models-name"],
    [formatModelSize(model), "text-muted mono"],
    [renderStatus(model), ""],
    [renderActions(model, dialogs), ""]
  ];
  return (
    <tr>
      {tableData.map(([content, className], index) => (
        <td key={index} className={className}>
          {content}
        </td>
      ))}
    </tr>
  );
}

function renderStatus(model) {
  const status = STATUSES.find(({ check }) => check(model));
  if (!status) return null;
  const { className, text } = status;
  const isBadge = className.includes("badge");
  return (
    <span className={className}>
      {isBadge && <span className="badge-dot" />} {text}
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
