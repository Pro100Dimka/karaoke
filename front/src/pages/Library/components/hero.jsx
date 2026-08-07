import darkIcon from "../../../assets/icons/dark.png";
import greenIcon from "../../../assets/icons/green.png";
import lightIcon from "../../../assets/icons/light.png";
import violetIcon from "../../../assets/icons/violet.png";
import { Card } from "../../../components/ui";
import useAppSettings from "../../../hooks/useAppSettings";

const LIB_INFO = [
  ["span", "ВАША МУЗЫКАЛЬНАЯ КОЛЛЕКЦИЯ"],
  ["h1", "Библиотека песен"],
  ["p", "Добавляйте треки, управляйте обработкой и открывайте их в караоке."]
];

const STATS = [
  ["всего песен", "songCount"],
  ["готово к караоке", "readyCount"]
];

const THEME_ICONS = {
  dark: darkIcon,
  light: lightIcon,
  green: greenIcon,
  violet: violetIcon
};

export default function LibraryHero({ songCount, readyCount }) {
  const { theme } = useAppSettings()?.settings || {};
  const values = { songCount, readyCount };
  return (
    <section className="library-hero">
      <Card
        aria-hidden="true"
        variant="neon"
        className="library-hero-brand-mark"
        cardPanel={{ style: { background: "unset" } }}
        cardContent={{
          style: {
            display: "flex",
            alignItems: "center",
            justifyContent: "center"
          }
        }}
      >
        <img
          src={THEME_ICONS[theme] ?? THEME_ICONS.dark}
          alt=""
          style={{
            width: "100%",
            height: "100%",
            objectFit: "cover"
          }}
        />
      </Card>

      <div className="library-hero-copy">
        {LIB_INFO.map(([Tag, text]) => (
          <Tag key={Tag}>{text}</Tag>
        ))}
      </div>

      <div className="library-hero-stats">
        {STATS.map(([label, key]) => (
          <Card key={key} className="library-stat-card" variant="glass">
            <b>{values[key]}</b>
            <span>{label}</span>
          </Card>
        ))}
      </div>
    </section>
  );
}
