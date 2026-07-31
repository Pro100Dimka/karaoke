import { NavLink } from "react-router-dom";
import {
  Library, CircleDot, Music2, Settings as SettingsIcon,
} from "lucide-react";

const NAV_ITEMS = [
  { to: "/", label: "Библиотека", icon: Library, end: true },
  { to: "/karaoke", label: "Караоке", icon: Music2 },
  { to: "/recording", label: "Запись", icon: CircleDot },
  { to: "/settings", label: "Настройки", icon: SettingsIcon },
];

export default function Sidebar() {
  return (
    <nav
      style={{
        width: 92,
        flexShrink: 0,
        borderRight: "1px solid var(--card-border)",
        background: "rgba(10, 7, 21, 0.4)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "16px 0",
        gap: 6,
        overflowY: "auto",
      }}
    >
      {NAV_ITEMS.map(({ to, label, icon: Icon, end }) => (
        <NavLink
          key={to}
          to={to}
          end={end}
          style={({ isActive }) => ({
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: 4,
            width: 76,
            padding: "10px 4px",
            borderRadius: 12,
            textDecoration: "none",
            color: isActive ? "#fff" : "var(--text-secondary)",
            background: isActive ? "var(--accent-gradient)" : "transparent",
            fontSize: 10.5,
            fontWeight: 600,
            textAlign: "center",
            transition: "background 0.15s ease",
          })}
        >
          <Icon size={18} />
          {label}
        </NavLink>
      ))}
    </nav>
  );
}
