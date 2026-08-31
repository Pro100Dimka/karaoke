import { createRoot } from "react-dom/client";
import "../../src/index.css";
import { Select } from "../../src/theme/ui";
import "../../src/theme/ui/base";

const options = [
  { value: "shared", label: "Windows Driver" },
  { value: "input", label: "Эксклюзивный микрофон, совместный выход" },
  { value: "exclusive", label: "Полностью эксклюзивный — только мониторинг" },
  ...Array.from({ length: 12 }, (_, index) => ({
    value: `device-${index}`,
    label: `Микрофон ${index + 1} — Analogue 1/2 (6- Audient iD14) — длинное название устройства`,
    description: "Подробное описание устройства и режима без сокращений и многоточия",
    group: "Аудиоустройства с длинным названием группы",
    disabled: index === 1
  })),
  { value: "unbroken", label: "VeryLongAudioDeviceIdentifier".repeat(5) }
];

createRoot(document.getElementById("root")).render(
  <main style={{ padding: 24, minHeight: "100vh", background: "#14060a", color: "#fff" }}>
    <h1>Select: длинные значения</h1>
    <div style={{ display: "flex", flexWrap: "wrap", gap: 24 }}>
      {["xs", "sm", "md", "lg"].map((size) => (
        <div key={size} style={{ width: 240, maxWidth: "100%" }}>
          <Select label={`Размер ${size}`} size={size} options={options} defaultValue="exclusive" />
        </div>
      ))}
    </div>
    <div style={{ position: "fixed", right: 8, bottom: 8, width: 240, maxWidth: "calc(100vw - 16px)" }}>
      <Select label="Нижний край" options={options} defaultValue="shared" />
    </div>
  </main>
);
