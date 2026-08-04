import { Trash2 } from "lucide-react";
import Button from "../../../../components/fields/button";
import Dropdown from "../../../../components/fields/dropdown";

const ROW_STYLE = {
  display: "flex",
  gap: 10,
  alignItems: "center"
};

export async function runMemoryAction({ request, getMessage, notify }) {
  try {
    const result = await request();
    await notify(getMessage(result));
    return true;
  } catch (error) {
    await notify(error?.message ?? "Не удалось выполнить действие");
    return false;
  }
}
export function MemoryStats({ size, free }) {
  return (
    <>
      <div style={{ fontSize: 14, marginBottom: 4 }}>
        Всего занято: <b>{size.total_human}</b>
      </div>

      {free && (
        <div className="text-muted" style={{ fontSize: 13, marginBottom: 20 }}>
          Свободно на диске: {free.free_human} из {free.total_human}
        </div>
      )}
    </>
  );
}

export function MemoryActions({ actions, notify }) {
  return (
    <div style={ROW_STYLE}>
      {actions.map(([id, label, icon, variant, request, getMessage]) => (
        <Button
          key={id}
          icon={icon}
          iconSize={14}
          variant={variant}
          onClick={() =>
            runMemoryAction({
              request,
              getMessage,
              notify
            })
          }
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

export function OptimizeSong({ value, options, onChange, onOptimize }) {
  return (
    <div style={{ ...ROW_STYLE, marginTop: 20 }}>
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

export function formatBytes(bytes = 0) {
  return `${(Number(bytes) / 1024 ** 2).toFixed(1)} МБ`;
}
