"""
Настройка локальной SQLite-базы через SQLAlchemy.

SQLite выбрана потому, что это десктоп-программа: один файл на диске,
не нужен отдельный процесс сервера БД, работает "из коробки" без установки
чего-либо дополнительного пользователем.
"""
from app import config
from sqlalchemy import create_engine
from sqlalchemy.orm import declarative_base, sessionmaker

# check_same_thread=False — нужно, т.к. FastAPI обрабатывает запросы в разных
# потоках (и фоновая обработка песни в pipeline_service тоже работает в
# отдельном потоке). Сама SQLite при этом не потокобезопасна "из коробки" для
# ОДНОГО соединения, поэтому мы открываем новую Session на каждый запрос/
# фоновую задачу через SessionLocal(), а не шарим одно соединение.
engine = create_engine(
    config.DATABASE_URL,
    connect_args={"check_same_thread": False},
)

SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=engine)

Base = declarative_base()


def init_db() -> None:
    """Создаёт таблицы, если их ещё нет. Вызывается один раз при старте приложения."""
    import app.database.models  # noqa: F401

    Base.metadata.create_all(bind=engine)


def get_db():
    """FastAPI-зависимость: одна Session на запрос, всегда закрывается."""
    db = SessionLocal()
    try:
        yield db
    finally:
        db.close()