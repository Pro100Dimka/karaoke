from pathlib import Path
from types import SimpleNamespace

from sqlalchemy import create_engine, text

from AI.engines.text import (
    Qwen3ForcedAligner,
    Qwen3Transcriber,
    _consensus_language,
    resolve_alignment_language,
)
from database import _repair_invalid_audio_settings_datetime


class _FakeASR:
    def transcribe(self, **kwargs):
        assert "language" not in kwargs
        return [SimpleNamespace(language="Russian", text="Привет мир", time_stamps=None)]


class _FakeAligner:
    def align(self, *, audio, text, language):
        assert language == "Russian"
        return [
            SimpleNamespace(
                items=[
                    SimpleNamespace(text="Привет", start_time=0.0, end_time=0.5),
                    SimpleNamespace(text="мир", start_time=0.5, end_time=1.0),
                ]
            )
        ]


def test_qwen_auto_language_is_preserved(monkeypatch):
    engine = Qwen3Transcriber("fake")
    monkeypatch.setattr(engine, "_load", lambda: _FakeASR())
    text_value, words = engine.transcribe(Path("voice.wav"), None)
    assert text_value == "Привет мир"
    assert words == []
    assert engine.last_language == "Russian"


def test_forced_aligner_never_receives_none_language(monkeypatch):
    engine = Qwen3ForcedAligner("fake")
    monkeypatch.setattr(engine, "_load", lambda: _FakeAligner())
    words = engine.align(Path("voice.wav"), "Привет мир", None)
    assert [w.text for w in words] == ["Привет", "мир"]


def test_alignment_language_inference():
    assert resolve_alignment_language("Привет мир") == "Russian"
    assert resolve_alignment_language("Привіт світ") == "Ukrainian"
    assert resolve_alignment_language("Hello world") == "English"


def test_language_consensus_weights_actual_script_not_chunk_count():
    texts = [
        "Мы так старались и хотели, чтобы кто-нибудь услышал",
        "Дети мертвых улиц собирали счастье из осколков",
        "Twilight years",
        "Falling down",
        "Oh",
    ]

    assert (
        _consensus_language(texts, ["Russian", "Russian", "English", "English", "English"], None)
        == "Russian"
    )


def test_audio_datetime_repair_handles_non_text_sqlite_values():
    engine = create_engine("sqlite:///:memory:")
    with engine.begin() as connection:
        connection.execute(
            text("CREATE TABLE audio_settings (id INTEGER PRIMARY KEY, updated_at DATETIME)")
        )
        connection.execute(text("INSERT INTO audio_settings (id, updated_at) VALUES (1, 12345)"))
        _repair_invalid_audio_settings_datetime(connection)
        value = connection.execute(
            text("SELECT updated_at, typeof(updated_at) FROM audio_settings WHERE id=1")
        ).one()
        assert value[1] == "text"
        assert isinstance(value[0], str)
        assert "-" in value[0]
