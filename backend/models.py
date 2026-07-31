"""
ORM-модели SQLite-базы backend'а.

Важно: это метаданные ПРО песни/записи/настройки, а не сами
результаты AI-анализа — тяжёлые данные (pitch.json, reference.json,
melody.mid и т.д.) как были, так и остаются файлами в Song/<slug>/,
которые AI-пайплайн уже умеет писать. База нужна только чтобы backend
знал, что обработано, где лежит и в каком статусе.
"""
import enum
import uuid
from datetime import datetime

from sqlalchemy import (
    Boolean, Column, DateTime, Enum, Float, ForeignKey, Integer, String, Text,
)
from sqlalchemy.orm import relationship

from database import Base


def _new_id() -> str:
    return uuid.uuid4().hex


class SongStatus(str, enum.Enum):
    PENDING = "pending"        # добавлена, обработка ещё не запускалась
    QUEUED = "queued"          # обработка запрошена, ждёт своей очереди
    PROCESSING = "processing"  # AI-пайплайн работает
    DONE = "done"               # готово
    CANCELLED = "cancelled"     # отменено пользователем
    ERROR = "error"             # упало с ошибкой


class Song(Base):
    __tablename__ = "songs"

    id = Column(String, primary_key=True, default=_new_id)
    title = Column(String, nullable=False)
    original_filename = Column(String, nullable=False)
    source_path = Column(String, nullable=False)      # full_songs/<file>
    slug = Column(String, unique=True, nullable=False)  # имя папки в Song/<slug>
    output_dir = Column(String, nullable=True)          # Song/<slug> (после обработки)

    status = Column(Enum(SongStatus), nullable=False, default=SongStatus.PENDING)
    progress_step = Column(String, nullable=True)       # напр. "6/13" — последний пройденный шаг
    progress_percent = Column(Float, nullable=False, default=0.0)
    error_message = Column(Text, nullable=True)

    # Пользовательские переопределения поверх того, что определил AI
    key_override = Column(String, nullable=True)
    tempo_override = Column(Float, nullable=True)
    note_range_min = Column(Integer, nullable=True)     # MIDI-номер
    note_range_max = Column(Integer, nullable=True)
    difficulty_override = Column(String, nullable=True)
    show_lyrics = Column(Boolean, nullable=False, default=True)
    show_notes = Column(Boolean, nullable=False, default=True)

    optimized = Column(Boolean, nullable=False, default=False)  # см. cache_service.optimize

    created_at = Column(DateTime, default=datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    recordings = relationship("Recording", back_populates="song", cascade="all, delete-orphan")
    playback_state = relationship(
        "PlaybackState", back_populates="song", uselist=False, cascade="all, delete-orphan"
    )


class Recording(Base):
    __tablename__ = "recordings"

    id = Column(String, primary_key=True, default=_new_id)
    song_id = Column(String, ForeignKey("songs.id"), nullable=False)
    filename = Column(String, nullable=False)
    path = Column(String, nullable=False)
    duration_sec = Column(Float, nullable=True)
    sample_rate = Column(Integer, nullable=True)
    created_at = Column(DateTime, default=datetime.utcnow)

    song = relationship("Song", back_populates="recordings")
    analysis = relationship(
        "AnalysisResult", back_populates="recording", uselist=False, cascade="all, delete-orphan"
    )


class AnalysisResult(Base):
    __tablename__ = "analysis_results"

    id = Column(String, primary_key=True, default=_new_id)
    recording_id = Column(String, ForeignKey("recordings.id"), unique=True, nullable=False)

    pitch_accuracy_percent = Column(Float, nullable=True)   # доля кадров "в ноте"
    mean_deviation_semitones = Column(Float, nullable=True)  # среднее отклонение от эталона
    sections_json = Column(Text, nullable=True)              # разбивка по кускам песни, JSON-строка
    created_at = Column(DateTime, default=datetime.utcnow)

    recording = relationship("Recording", back_populates="analysis")


class PlaybackState(Base):
    """Серверное состояние плеера для конкретной песни (позиция, играет/стоит).
    Сам звук воспроизводит клиент — backend только хранит состояние синхронизации,
    чтобы разные части UI (плеер, ноты, текст) могли сверяться с одним источником правды."""
    __tablename__ = "playback_states"

    song_id = Column(String, ForeignKey("songs.id"), primary_key=True)
    position_sec = Column(Float, nullable=False, default=0.0)
    is_playing = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)

    song = relationship("Song", back_populates="playback_state")


class AudioSettings(Base):
    """Настройки микрофона/записи. Практически singleton — одна строка с id=1."""
    __tablename__ = "audio_settings"

    id = Column(Integer, primary_key=True, default=1)
    input_device_id = Column(Integer, nullable=True)
    input_device_name = Column(String, nullable=True)
    volume = Column(Float, nullable=False, default=1.0)        # 0..1
    sensitivity = Column(Float, nullable=False, default=0.5)   # 0..1, произвольная шкала для UI
    latency_ms = Column(Integer, nullable=False, default=50)
    monitoring_enabled = Column(Boolean, nullable=False, default=False)
    updated_at = Column(DateTime, default=datetime.utcnow, onupdate=datetime.utcnow)
