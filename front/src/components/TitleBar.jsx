import { Minus, Square, X } from "lucide-react";

export default function TitleBar({ title }) {
  const electronAPI = window.electronAPI;

  return (
    <div
      style={{
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 4px 0 16px",
        WebkitAppRegion: "drag",
        background: "rgba(10, 7, 21, 0.6)",
        borderBottom: "1px solid var(--card-border)",
        flexShrink: 0,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, fontWeight: 600 }}>
        <span
          style={{
            width: 8,
            height: 8,
            borderRadius: "50%",
            background: "var(--accent-gradient)",
            display: "inline-block",
          }}
        />
        <span className="text-secondary">{title || "Karaoke Studio"}</span>
      </div>

      {electronAPI && (
        <div style={{ display: "flex", WebkitAppRegion: "no-drag" }}>
          <TitleBarButton onClick={() => electronAPI.minimize()}>
            <Minus size={14} />
          </TitleBarButton>
          <TitleBarButton onClick={() => electronAPI.maximize()}>
            <Square size={12} />
          </TitleBarButton>
          <TitleBarButton onClick={() => electronAPI.close()} danger>
            <X size={14} />
          </TitleBarButton>
        </div>
      )}
    </div>
  );
}

function TitleBarButton({ children, onClick, danger }) {
  return (
    <button
      onClick={onClick}
      style={{
        width: 44,
        height: 40,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "transparent",
        border: "none",
        color: danger ? "#f87171" : "var(--text-secondary)",
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = danger ? "rgba(239,68,68,0.2)" : "rgba(255,255,255,0.06)";
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = "transparent";
      }}
    >
      {children}
    </button>
  );
}
