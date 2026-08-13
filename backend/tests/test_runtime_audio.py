from pathlib import Path

import config
from app.services import audio_service, monitor_worker, recording_service
from app.services.song_editor_service import _refresh_lines, normalize_editor_timeline


def test_runtime_executable_prefers_packaged_sibling(monkeypatch, tmp_path):
    backend = tmp_path / "backend"
    backend.mkdir()
    executable = backend / "KaraokeBackend.exe"
    ffmpeg = backend / "ffmpeg.exe"
    executable.touch()
    ffmpeg.touch()
    monkeypatch.setattr(config.sys, "executable", str(executable))

    assert config.resolve_runtime_executable("ffmpeg") == str(ffmpeg)


def test_auto_input_does_not_promote_unreliable_wdm(monkeypatch):
    devices = [
        {"name": "USB Microphone", "hostapi": 0, "max_input_channels": 1},
        {"name": "USB Microphone", "hostapi": 1, "max_input_channels": 1},
    ]
    monkeypatch.setattr(audio_service.sd, "query_devices", lambda *_args, **_kwargs: devices)
    monkeypatch.setattr(
        audio_service,
        "_host_api_name",
        lambda device: "MME" if device["hostapi"] == 0 else "Windows WDM-KS",
    )

    assert audio_service._low_latency_equivalent(0, "input") == 0


def test_duplex_output_uses_same_host_api(monkeypatch):
    devices = [
        {
            "name": "USB Microphone",
            "hostapi": 0,
            "max_input_channels": 1,
            "max_output_channels": 0,
            "default_samplerate": 44_100,
        },
        {
            "name": "USB Speakers",
            "hostapi": 1,
            "max_input_channels": 0,
            "max_output_channels": 2,
            "default_samplerate": 44_100,
        },
        {
            "name": "USB Speakers",
            "hostapi": 0,
            "max_input_channels": 0,
            "max_output_channels": 2,
            "default_samplerate": 44_100,
        },
    ]
    monkeypatch.setattr(audio_service.sd, "query_devices", lambda *_args, **_kwargs: devices)
    monkeypatch.setattr(audio_service, "_low_latency_equivalent", lambda *_args: 1)
    monkeypatch.setattr(
        audio_service,
        "_host_api_name",
        lambda device: "Windows WASAPI" if device["hostapi"] == 1 else "MME",
    )

    assert audio_service._matching_output_for_input(0, None) == 2


def test_wasapi_candidates_end_with_host_neutral_fallback():
    candidates = monitor_worker._stream_candidates(
        {
            "sample_rate": 48_000,
            "output_channels": 2,
            "input_device_id": 1,
            "output_device_id": 2,
            "blocksize": 64,
            "wasapi_exclusive": True,
        }
    )

    assert candidates[0]["blocksize"] == 64
    assert "extra_settings" in candidates[0]
    assert "extra_settings" not in candidates[-1]
    assert Path(config.FFMPEG_EXE).name.casefold() in {"ffmpeg", "ffmpeg.exe"}


def test_recording_falls_back_from_duplex_to_plain_microphone(monkeypatch):
    monkeypatch.setattr(
        recording_service.sd,
        "query_devices",
        lambda *_args, **_kwargs: {"default_samplerate": 48_000},
    )
    attempts = recording_service._capture_attempts(7, 9, 44_100, 64, True)

    assert attempts[0] == (7, 9, 44_100, 64, True, "low")
    assert attempts[1] == (7, None, 44_100, 0, False, "high")
    assert (7, None, 48_000, 0, False, "high") in attempts
    assert attempts[-1][0] is None


def test_merged_note_projects_distinct_syllable_windows():
    song_map = {
        "syllables": [
            {"index": 0, "word_index": 0, "text": "бо"},
            {"index": 1, "word_index": 0, "text": "льшой"},
        ],
        "words": [{"index": 0, "text": "большой"}],
        "lines": [{"words": [{"index": 0}]}],
    }
    notes = [
        {
            "start": 2.0,
            "end": 4.0,
            "midi_note": 60,
            "syllable_index": 0,
            "syllable_indices": [0, 1],
        }
    ]

    _refresh_lines(song_map, notes)

    first, second = song_map["syllables"]
    assert (first["start"], first["end"]) == (2.0, 3.0)
    assert (second["start"], second["end"]) == (3.0, 4.0)


def test_multiple_merged_notes_cannot_create_simultaneous_lyrics():
    song_map = {
        "editor": {"edited": True},
        "syllables": [
            {"index": 0, "word_index": 0, "text": "и"},
            {"index": 1, "word_index": 1, "text": "до"},
            {"index": 2, "word_index": 1, "text": "ма"},
        ],
        "words": [
            {"index": 0, "text": "и"},
            {"index": 1, "text": "дома"},
        ],
        "lines": [{"words": [{"index": 0}, {"index": 1}]}],
        "notes": [
            {
                "start": 9.0,
                "end": 9.2,
                "midi_note": 55,
                "syllable_indices": [0, 1, 2],
            },
            {
                "start": 9.25,
                "end": 9.75,
                "midi_note": 55,
                "syllable_indices": [0, 1, 2],
            },
        ],
    }

    normalize_editor_timeline(song_map)

    syllables = song_map["syllables"]
    assert all(
        left["end"] <= right["start"] for left, right in zip(syllables, syllables[1:], strict=False)
    )
    words = song_map["words"]
    assert words[0]["end"] <= words[1]["start"]
