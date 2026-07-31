"""
Pydantic-схемы: тела запросов/ответов API.

Отдельно от models.py (ORM) сознательно — наружу мы не всегда хотим отдавать
ровно то, что лежит в базе (например source_path — внутренний путь на диске,
наружу отдаём только то, что реально нужно фронтенду).
"""
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from models import SongStatus


# --------------------------------------------------------------------
# Песни
# --------------------------------------------------------------------

class SongOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    original_filename: str
    slug: str
    output_dir: Optional[str] = None
    status: SongStatus
    progress_step: Optional[str] = None
    progress_percent: float
    error_message: Optional[str] = None

    key_override: Optional[str] = None
    tempo_override: Optional[float] = None
    note_range_min: Optional[int] = None
    note_range_max: Optional[int] = None
    difficulty_override: Optional[str] = None
    video_url: Optional[str] = None
    show_lyrics: bool
    show_notes: bool
    optimized: bool

    created_at: datetime
    updated_at: datetime


class SongUpdate(BaseModel):
    """Все поля опциональны — PATCH-семантика, меняем только переданное."""
    title: Optional[str] = None
    key_override: Optional[str] = None
    tempo_override: Optional[float] = Field(default=None, gt=0)
    note_range_min: Optional[int] = Field(default=None, ge=0, le=127)
    note_range_max: Optional[int] = Field(default=None, ge=0, le=127)
    difficulty_override: Optional[str] = None
    video_url: Optional[str] = Field(default=None, max_length=2048)
    show_lyrics: Optional[bool] = None
    show_notes: Optional[bool] = None


class LyricsUpdate(BaseModel):
    lyrics: Any


class ProcessingStatusOut(BaseModel):
    song_id: str
    status: SongStatus
    progress_step: Optional[str] = None
    progress_percent: float
    progress_detail: Optional[str] = None
    eta_seconds: Optional[int] = None
    error_message: Optional[str] = None


class SongResultOut(BaseModel):
    """Агрегированные результаты AI-пайплайна по одной песне (содержимое Song/<slug>/*.json)."""
    song: SongOut
    music: Optional[dict[str, Any]] = None
    reference_notes: Optional[list[dict[str, Any]]] = None
    lyrics_sync: Optional[Any] = None
    song_map: Optional[dict[str, Any]] = None
    difficulty: Optional[Any] = None
    structure: Optional[Any] = None
    breaths: Optional[Any] = None
    manifest: Optional[dict[str, Any]] = None


# --------------------------------------------------------------------
# Плеер
# --------------------------------------------------------------------

class PlaybackStateOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    song_id: str
    position_sec: float
    is_playing: bool


class SeekRequest(BaseModel):
    position_sec: float = Field(ge=0)


# --------------------------------------------------------------------
# Записи голоса
# --------------------------------------------------------------------

class RecordingOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    song_id: str
    filename: str
    duration_sec: Optional[float] = None
    sample_rate: Optional[int] = None
    created_at: datetime


class RecordedSongOut(RecordingOut):
    song_title: str


class RecordingStartRequest(BaseModel):
    song_id: str
    position_sec: float = Field(default=0, ge=0)


class RecordingStartOut(BaseModel):
    recording_session_id: str
    message: str


# --------------------------------------------------------------------
# Анализ голоса
# --------------------------------------------------------------------

class AnalysisOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    recording_id: str
    pitch_accuracy_percent: Optional[float] = None
    mean_deviation_semitones: Optional[float] = None
    sections: Optional[list[dict[str, Any]]] = None
    created_at: datetime


# --------------------------------------------------------------------
# Кэш/производительность
# --------------------------------------------------------------------

class CacheSizeOut(BaseModel):
    total_bytes: int
    total_human: str
    breakdown: dict[str, int]


class FreeSpaceOut(BaseModel):
    free_bytes: int
    free_human: str
    total_bytes: int
    total_human: str


class OptimizeResultOut(BaseModel):
    song_id: str
    freed_bytes: int
    freed_human: str
    actions: list[str]


# --------------------------------------------------------------------
# Диагностика
# --------------------------------------------------------------------

class HealthOut(BaseModel):
    status: str
    version: str


class PipelineHealthOut(BaseModel):
    ffmpeg_available: bool
    demucs_available: bool
    whisper_available: bool
    torch_available: bool
    cuda_available: bool
    ai_dir_found: bool


class VersionsOut(BaseModel):
    backend_version: str
    python_version: str
    components: dict[str, Optional[str]]


class SystemErrorsOut(BaseModel):
    errors: list[dict[str, Any]]


# --------------------------------------------------------------------
# Аудио-устройства
# --------------------------------------------------------------------

class AudioDeviceOut(BaseModel):
    index: int
    name: str
    max_input_channels: int
    default_samplerate: Optional[float] = None


class AudioSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    input_device_id: Optional[int] = None
    input_device_name: Optional[str] = None
    volume: float
    sensitivity: float
    latency_ms: int
    monitoring_enabled: bool


class AudioSettingsUpdate(BaseModel):
    input_device_id: Optional[int] = None
    volume: Optional[float] = Field(default=None, ge=0, le=4)
    sensitivity: Optional[float] = Field(default=None, ge=0, le=1)
    latency_ms: Optional[int] = Field(default=None, ge=0)
    monitoring_enabled: Optional[bool] = None


class SignalQualityOut(BaseModel):
    rms_db: float
    clipping: bool
    silent: bool
