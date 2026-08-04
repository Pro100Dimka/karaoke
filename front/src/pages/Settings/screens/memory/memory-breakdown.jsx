import { MEMORY_SECTIONS } from "./config";
import { formatBytes } from "./utils";

export default function MemoryBreakdown({ breakdown = {} }) {
  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: "repeat(3, 1fr)",
        gap: 14,
        marginBottom: 20
      }}
    >
      {Object.entries(breakdown).map(([key, bytes]) => (
        <div
          key={key}
          style={{
            background: "rgba(255,255,255,0.04)",
            borderRadius: 12,
            padding: 14
          }}
        >
          <div className="text-muted" style={{ fontSize: 12 }}>
            {MEMORY_SECTIONS[key] ?? key}
          </div>
          <div style={{ fontWeight: 700, fontSize: 18 }}>
            {formatBytes(bytes)}
          </div>
        </div>
      ))}
    </div>
  );
}
