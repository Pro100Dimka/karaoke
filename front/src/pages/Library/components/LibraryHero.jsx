import { Music2 } from "lucide-react";
import { Card } from "../../../components/ui";

export default function LibraryHero({ songCount, readyCount }) {
  return (
    <section className="library-hero">
      <div className="library-hero-brand-mark" aria-hidden="true">
        <Music2 size={30} />
        <i />
        <i />
      </div>
      <div className="library-hero-copy">
        <span>ВАША МУЗЫКАЛЬНАЯ КОЛЛЕКЦИЯ</span>
        <h1>Библиотека песен</h1>
        <p>
          Добавляйте треки, управляйте обработкой и открывайте их в караоке.
        </p>
      </div>
      <div className="library-hero-stats">
        <Card className="library-stat-card">
          <b>{songCount}</b>
          <span>всего песен</span>
        </Card>
        <Card className="library-stat-card">
          <b>{readyCount}</b>
          <span>готово к караоке</span>
        </Card>
      </div>
    </section>
  );
}
