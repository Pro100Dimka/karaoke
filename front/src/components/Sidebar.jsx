import { NavLink } from "react-router-dom";
import { Library, CircleDot, Music2, Settings as SettingsIcon, Sparkles } from "lucide-react";

const NAV_ITEMS = [
  { to: "/", label: "Библиотека", caption: "Песни", icon: Library, end: true },
  { to: "/karaoke", label: "Караоке", caption: "Исполнение", icon: Music2 },
  { to: "/recording", label: "Записи", caption: "Результаты", icon: CircleDot },
  { to: "/settings", label: "Настройки", caption: "Приложение", icon: SettingsIcon },
];

export default function Sidebar() {
  return <nav className="sidebar" aria-label="Навигация">
    <div className="sidebar-brand"><span className="sidebar-brand-orbit"><Sparkles size={22} /></span><span className="sidebar-brand-copy"><strong>Karaoke</strong><small>Studio</small></span></div>
    <div className="sidebar-links">
      {NAV_ITEMS.map(({ to, label, caption, icon: Icon, end }) => <NavLink key={to} to={to} end={end}
        className={({ isActive }) => `sidebar-link ${isActive ? "is-active" : ""}`}>
        <span className="sidebar-link-icon"><Icon size={19} /></span>
        <span className="sidebar-link-copy"><strong>{label}</strong><small>{caption}</small></span>
      </NavLink>)}
    </div>
    <div className="sidebar-footer">Karaoke<br />Studio</div>
  </nav>;
}
