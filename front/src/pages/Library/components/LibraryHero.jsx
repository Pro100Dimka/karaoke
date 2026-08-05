import { Music2 } from "lucide-react";
import { Card } from "../../../components/ui";

export default function LibraryHero({ songCount, readyCount }) {
  return (
    <section className="library-hero">
      <Card className="library-hero-brand-mark" aria-hidden="true">
        <Music2 size={30} />
        <i />
        <i />
      </Card>
      <div className="library-hero-copy">
        <span>ВАША МУЗЫКАЛЬНАЯ КОЛЛЕКЦИЯ</span>
        <h1>Библиотека песен</h1>
        <p>
          Добавляйте треки, управляйте обработкой и открывайте их в караоке.
        </p>
      </div>
      <div className="library-hero-stats">
        <Card className="library-stat-card" variant="glass">
          <b>{songCount}</b>
          <span>всего песен</span>
        </Card>
        <Card className="library-stat-card" variant="glass">
          <b>{readyCount}</b>
          <span>готово к караоке</span>
        </Card>
      </div>
    </section>
  );
}
