"""
Pydantic-схемы: тела запросов/ответов API.

Отдельно от models.py (ORM) сознательно — наружу мы не всегда хотим отдавать
ровно то, что лежит в базе (например source_path — внутренний путь на диске,
наружу отдаём только то, что реально нужно фронтенду).
"""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict, Field

from models import SongStatus

# --------------------------------------------------------------------
# Песни
# --------------------------------------------------------------------

class SongOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: str
    title: str
    artist: str | None = None
    genre: str | None = None
    original_filename: str
    slug: str
    output_dir: str | None = None
    status: SongStatus
    progress_step: str | None = None
    progress_percent: float
    error_message: str | None = None

    key_override: str | None = None
    tempo_override: float | None = None
    note_range_min: int | None = None
    note_range_max: int | None = None
    difficulty_override: str | None = None
    video_url: str | None = None
    show_lyrics: bool
    show_notes: bool
    optimized: bool

    created_at: datetime
    updated_at: datetime


class SongUpdate(BaseModel):
    """Все поля опциональны — PATCH-семантика, меняем только переданное."""
    title: str | None = None
    artist: str | None = Field(default=None, max_length=255)
    genre: str | None = Field(default=None, max_length=255)
    key_override: str | None = None
    tempo_override: float | None = Field(default=None, gt=0)
    note_range_min: int | None = Field(default=None, ge=0, le=127)
    note_range_max: int | None = Field(default=None, ge=0, le=127)
    difficulty_override: str | None = None
    video_url: str | None = Field(default=None, max_length=2048)
    show_lyrics: bool | None = None
    show_notes: bool | None = None


class LyricsUpdate(BaseModel):
    lyrics: Any


class ProcessingStatusOut(BaseModel):
    song_id: str
    status: SongStatus
    progress_step: str | None = None
    progress_percent: float
    progress_detail: str | None = None
    eta_seconds: int | None = None
    error_message: str | None = None


class SongResultOut(BaseModel):
    """Агрегированные результаты AI-пайплайна по одной песне (содержимое Song/<slug>/*.json)."""
    song: SongOut
    music: dict[str, Any] | None = None
    reference_notes: list[dict[str, Any]] | None = None
    lyrics_sync: Any | None = None
    song_map: dict[str, Any] | None = None
    difficulty: Any | None = None
    structure: Any | None = None
    breaths: Any | None = None
    manifest: dict[str, Any] | None = None


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
    duration_sec: float | None = None
    sample_rate: int | None = None
    created_at: datetime


class RecordedSongOut(RecordingOut):
    song_title: str


class RecordingStartRequest(BaseModel):
    song_id: str
    position_sec: float = Field(default=0, ge=0)
    music_volume: float = Field(default=1, ge=0, le=1)
    vocal_volume: float = Field(default=1, ge=0, le=1)


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
    pitch_accuracy_percent: float | None = None
    mean_deviation_semitones: float | None = None
    sections: list[dict[str, Any]] | None = None
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
    components: dict[str, str | None]


class SystemErrorsOut(BaseModel):
    errors: list[dict[str, Any]]


# --------------------------------------------------------------------
# Аудио-устройства
# --------------------------------------------------------------------

class AudioDeviceOut(BaseModel):
    index: int
    name: str
    max_input_channels: int
    default_samplerate: float | None = None
    host_api: str
    is_asio: bool


class AudioOutputDeviceOut(BaseModel):
    index: int
    name: str
    max_output_channels: int
    default_samplerate: float | None = None
    host_api: str
    is_asio: bool


class AsioDriverOut(BaseModel):
    name: str


class AudioSettingsOut(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    input_device_id: int | None = None
    input_device_name: str | None = None
    output_device_id: int | None = None
    volume: float
    sensitivity: float
    latency_ms: int
    audio_driver: str
    asio_driver_name: str | None = None
    buffer_size: int
    monitoring_enabled: bool


class AudioSettingsUpdate(BaseModel):
    input_device_id: int | None = None
    output_device_id: int | None = None
    volume: float | None = Field(default=None, ge=0, le=4)
    sensitivity: float | None = Field(default=None, ge=0, le=1)
    latency_ms: int | None = Field(default=None, ge=0)
    audio_driver: str | None = None
    asio_driver_name: str | None = Field(default=None, max_length=255)
    buffer_size: int | None = Field(default=None, ge=16, le=2048)
    monitoring_enabled: bool | None = None


class SignalQualityOut(BaseModel):
    rms_db: float
    clipping: bool
    silent: bool
