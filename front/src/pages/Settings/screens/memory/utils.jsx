import { Trash2 } from "lucide-react";
import Dropdown from "../../../../components/fields/Dropdown";
import Button from "../../../../components/fields/button";
import { getErrorMessage } from "../../../../utils/errors";

export async function runMemoryAction({ request, getMessage, notify }) {
  try {
    const result = await request();
    await notify(getMessage(result));
    return true;
  } catch (error) {
    await notify(getErrorMessage(error, "Не удалось выполнить действие"));
    return false;
  }
}

export function MemoryStats({ size, free }) {
  return (
    <div className="memory-stats">
      <p className="memory-stats-total">
        Всего занято: <strong>{size.total_human}</strong>
      </p>
      {free && (
        <p className="memory-stats-free text-muted">
          Свободно на диске: {free.free_human} из {free.total_human}
        </p>
      )}
    </div>
  );
}

export function MemoryActions({ actions, notify }) {
  return (
    <div className="memory-actions">
      {actions.map(([id, label, icon, variant, request, getMessage]) => (
        <Button
          key={id}
          icon={icon}
          iconSize={14}
          variant={variant}
          onClick={() => runMemoryAction({ request, getMessage, notify })}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

export function OptimizeSong({ value, options, onChange, onOptimize }) {
  return (
    <div className="memory-actions memory-optimize">
      <Dropdown value={value} options={options} onChange={onChange} />
      <Button
        icon={Trash2}
        iconSize={14}
        variant="ghost"
        disabled={!value}
        onClick={onOptimize}
      >
        Оптимизировать
      </Button>
    </div>
  );
}
