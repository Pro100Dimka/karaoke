import { Music2 } from "lucide-react";
import { Card } from "../../../components/ui";

const LIB_INFO = [
  ["span", "ВАША МУЗЫКАЛЬНАЯ КОЛЛЕКЦИЯ"],
  ["h1", "Библиотека песен"],
  ["p", "Добавляйте треки, управляйте обработкой и открывайте их в караоке."]
];
const STATS = [
  ["всего песен", "songCount"],
  ["готово к караоке", "readyCount"]
];

export default function LibraryHero({ songCount, readyCount }) {
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
        <Music2 size={30} />
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
