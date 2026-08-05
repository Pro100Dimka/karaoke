import { Music2 } from "lucide-react";

export default function LibraryHero({ songCount, readyCount }) {
  return (
    <section className="library-hero">
      <div className="library-hero-3d-scene" aria-hidden="true">
        <i className="library-hero-disc" />
        <i className="library-hero-prism" />
        <i className="library-hero-orbit library-hero-orbit--one" />
        <i className="library-hero-orbit library-hero-orbit--two" />
        <i className="library-hero-spark library-hero-spark--one" />
        <i className="library-hero-spark library-hero-spark--two" />
      </div>
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
        <div>
          <b>{songCount}</b>
          <span>всего песен</span>
        </div>
        <div>
          <b>{readyCount}</b>
          <span>готово к караоке</span>
        </div>
      </div>
    </section>
  );
}
