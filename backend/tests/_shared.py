

def patch_attrs(monkeypatch, target, /, **attrs):
    for name, value in attrs.items(): monkeypatch.setattr(target, name, value)


def patch_many(monkeypatch, *patches):
    for target, name, value in patches: monkeypatch.setattr(target, name, value)


def assert_http_status(status, invoke):
    import pytest; from fastapi import HTTPException

    with pytest.raises(HTTPException) as error: invoke()
    assert error.value.status_code == status


def make_song(tmp_path=None, **changes):
    import models

    base = {
        "id": "song",
        "title": "Song",
        "original_filename": "song.wav",
        "source_path": str(tmp_path / "source.wav") if tmp_path else "song.wav",
        "slug": "song",
    }
    if tmp_path is not None: base["output_dir"] = str(tmp_path)
    return models.Song(**{**base, **changes})


def raises(exception, invoke, *, match=None):
    import pytest

    with pytest.raises(exception, match=match): return invoke()


def alignment_result(words=(), confidence=0.0): from types import SimpleNamespace; return SimpleNamespace(words=words, confidence=confidence)


def mock_database(monkeypatch, module): from unittest.mock import Mock; database = Mock(); monkeypatch.setattr(module, "SessionLocal", Mock(return_value=database)); return database


def mock_song_lookup(monkeypatch, module, current=None): from unittest.mock import Mock; database = mock_database(monkeypatch, module); lookup = Mock(return_value=current); monkeypatch.setattr(module.repositories, "get_song", lookup); return database, lookup

def dump_json(path, value): import json; path.write_text(json.dumps(value, ensure_ascii=False), encoding="utf-8")


def pitch_frame(time, hz=220, confidence=0.8, voiced=True, energy=0.1): from AI.models import PitchFrame; return PitchFrame(time, hz if voiced else 0, confidence if voiced else 0, voiced, energy)


def midi_frame(time, midi=60, confidence=0.9, energy=1.0, voiced=True): hz = 440 * 2 ** ((midi - 69) / 12) if voiced else 0; return pitch_frame(time, hz, confidence, voiced, energy)


def missing_import(real_import, *blocked):
    def import_module(name, *args, **kwargs):
        if name in blocked: raise ImportError(name)
        return real_import(name, *args, **kwargs)

    return import_module


class FakeOrtSession:
    def __init__(self, input_name, output, providers=("CUDAExecutionProvider", "CPUExecutionProvider")): from unittest.mock import Mock; self.input_name, self.output, self.providers = input_name, output, providers; self.disable_fallback = Mock()

    def get_providers(self): return list(self.providers)

    def get_inputs(self): from types import SimpleNamespace; return [SimpleNamespace(name=self.input_name)]

    def run(self, *_): return [self.output]
