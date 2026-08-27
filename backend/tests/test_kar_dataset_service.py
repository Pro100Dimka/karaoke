import asyncio
import json
import sys
from pathlib import Path
from types import SimpleNamespace

import mido
import pytest

from app.routers import songs
from app.services import kar_dataset_service
from tests._shared import upload_file


def build_kar(path):
    midi = mido.MidiFile(ticks_per_beat=480)
    lyrics, melody = mido.MidiTrack(), mido.MidiTrack()
    midi.tracks.extend((lyrics, melody))
    lyrics.append(mido.MetaMessage("set_tempo", tempo=500_000, time=0))
    lyrics.append(mido.MetaMessage("text", text="@TTest Song", time=0))
    lyrics.append(mido.MetaMessage("text", text="@TArtist", time=0))
    lyrics.append(mido.MetaMessage("lyrics", text="\\Hel", time=480))
    lyrics.append(mido.MetaMessage("lyrics", text="lo ", time=240))
    lyrics.append(mido.MetaMessage("lyrics", text="world ", time=240))
    melody.append(mido.MetaMessage("track_name", name="Vocal Melody", time=0))
    melody.append(mido.Message("note_on", note=60, velocity=90, time=480))
    melody.append(mido.Message("note_off", note=60, velocity=0, time=480))
    melody.append(mido.Message("note_on", note=62, velocity=90, time=0))
    melody.append(mido.Message("note_off", note=62, velocity=0, time=480))
    midi.save(path)
    return path


def test_parses_kar_words_tempo_identity_and_melody(tmp_path):
    document = kar_dataset_service.parse_kar(build_kar(tmp_path / "song.kar"))

    assert (document.title, document.artist, document.bpm) == ("Test Song", "Artist", 120)
    assert [word["text"] for word in document.words] == ["Hello", "world"]
    assert document.melody_track == 1
    assert [note["note"] for word in document.words for note in word["notes"]] == [60, 62]


def test_real_tempo_at_tick_zero_overrides_midi_default(tmp_path):
    source = build_kar(tmp_path / "song.kar")
    midi = mido.MidiFile(source, charset="cp1251")
    midi.tracks[0][0] = mido.MetaMessage("set_tempo", tempo=454_545, time=0)
    midi.save(source)

    document = kar_dataset_service.parse_kar(source)

    assert document.bpm == pytest.approx(132, abs=0.001)
    assert document.words[0]["start"] == pytest.approx(0.455, abs=0.001)
    assert document.words[0]["notes"][0]["start"] == pytest.approx(0.455, abs=0.001)

    audio_tempo_document = kar_dataset_service.parse_kar(
        source,
        bpm_override=129,
        offset_seconds=-0.1,
    )
    assert audio_tempo_document.bpm == pytest.approx(129, abs=0.001)
    assert audio_tempo_document.words[0]["start"] == pytest.approx(0.365, abs=0.001)
    assert audio_tempo_document.words[0]["notes"][0]["start"] == pytest.approx(0.365, abs=0.001)


def test_named_melody_track_beats_dense_accompaniment(tmp_path):
    source = build_kar(tmp_path / "song.kar")
    midi = mido.MidiFile(source, charset="cp1251")
    accompaniment = mido.MidiTrack()
    midi.tracks.append(accompaniment)
    for note in range(36, 60):
        accompaniment.append(mido.Message("note_on", note=note, velocity=90, time=0))
    for note in range(36, 60):
        accompaniment.append(mido.Message("note_off", note=note, velocity=0, time=960))
    midi.save(source)

    document = kar_dataset_service.parse_kar(source)

    assert document.melody_track == 1
    assert [note["note"] for word in document.words for note in word["notes"]] == [60, 62]


def test_kar_melody_notes_are_owned_once_without_clipping(tmp_path):
    document = kar_dataset_service.parse_kar(build_kar(tmp_path / "song.kar"))
    notes = [note for word in document.words for note in word["notes"]]

    assert notes == [
        {"note": 60, "start": 0.5, "end": 1.0},
        {"note": 62, "start": 1.0, "end": 1.5},
    ]


def test_composite_kar_title_keeps_credits_out_of_song_identity(tmp_path):
    source = build_kar(tmp_path / "song.kar")
    midi = mido.MidiFile(source, charset="cp1251")
    midi.tracks[0][1].text = "@TБеспечный ангел - Ария"
    midi.tracks[0][2].text = "@TGolden Earring Пушкина М."
    midi.save(source)

    document = kar_dataset_service.parse_kar(source)

    assert (document.artist, document.title) == ("Ария", "Беспечный ангел")


def test_prepares_reviewable_dataset_without_network_or_ai(tmp_path):
    source = build_kar(tmp_path / "song.kar")
    result = kar_dataset_service.prepare_kar_file(
        source,
        output_root=tmp_path / "dataset",
        download_audio=False,
    )

    output = Path(result["dataset_dir"])
    metadata = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
    lyrics = json.loads((output / "lyricsSync.json").read_text(encoding="utf-8"))
    assert metadata["status"] == "review"
    assert metadata["word_count"] == 2
    assert lyrics["source"] == "kar"
    assert (output / "source.kar").is_file()
    assert output.name == "Artist Test Song"

    duplicate = kar_dataset_service.prepare_kar_file(
        source,
        output_root=tmp_path / "dataset",
        download_audio=False,
    )
    assert Path(duplicate["dataset_dir"]).name == "Artist Test Song (2)"


@pytest.mark.parametrize(("name", "payload"), [("song.mid", b"MThd"), ("song.kar", b"bad")])
def test_rejects_non_kar_and_invalid_midi(tmp_path, name, payload):
    source = tmp_path / name
    source.write_bytes(payload)
    with pytest.raises(ValueError):
        kar_dataset_service.parse_kar(source)


def test_original_audio_bpm_scales_kar_before_creating_lyrics(monkeypatch, tmp_path):
    source = build_kar(tmp_path / "song.kar")

    def download(_document, output):
        (output / "original.flac").write_bytes(b"audio")
        return {
            "midi_audio_match": {
                "score": 0.9,
                "kar_bpm": 120,
                "audio_bpm": 100,
                "detected_audio_bpm": 100,
                "time_scale": 1.2,
                "offset_seconds": 0,
                "pitch_shift_semitones": 0,
                "audio_duration": 2,
                "compared_notes": 50,
            }
        }

    monkeypatch.setattr(kar_dataset_service, "_download_audio", download)
    result = kar_dataset_service.prepare_kar_file(source, output_root=tmp_path / "dataset")
    output = Path(result["dataset_dir"])
    reference = json.loads((output / "lyricsSync.json").read_text(encoding="utf-8"))

    assert result["status"] == "ready"
    assert result["preparation_mode"] == "kar-with-original-audio-bpm"
    assert result["stems_status"] == "deferred"
    assert reference["bpm"] == 100
    assert reference["words"][0]["start"] == pytest.approx(0.6)
    assert reference["words"][0]["notes"][0]["start"] == pytest.approx(0.6)
    assert reference["words"][1]["end"] == pytest.approx(1.8)
    assert result["alignment"]["status"] == "audio-bpm-applied"
    assert result["alignment"]["offset_seconds"] == 0
    assert not (output / "lyricsSync.kar.raw.json").exists()
    assert not (output / "vocals.flac").exists()


def test_audio_search_prefers_original_and_rejects_karaoke():
    document = kar_dataset_service.KarDocument(
        title="Test Song",
        artist="Artist",
        bpm=120,
        key="C",
        duration=180,
        words=[],
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    accepted = {
        "title": "Artist - Test Song (Official Audio)",
        "uploader": "Artist",
        "duration": 181,
    }
    rejected = {"title": "Artist - Test Song Karaoke", "uploader": "Artist", "duration": 180}
    rejected_cover = {
        "title": "Test Song (Artist cover by tribute band)",
        "uploader": "Tribute band",
        "duration": 180,
    }

    assert kar_dataset_service._audio_candidate_score(accepted, document) is not None
    assert kar_dataset_service._audio_candidate_score(rejected, document) is None
    assert kar_dataset_service._audio_candidate_score(rejected_cover, document) is None


def test_audio_search_matches_transliterated_official_metadata():
    document = kar_dataset_service.KarDocument(
        title="Беспечный ангел",
        artist="Ария",
        bpm=120,
        key="C",
        duration=253,
        words=[],
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    official = {
        "title": "Bespechnyy angel",
        "uploader": "AriaRussia",
        "duration": 239,
    }

    assert kar_dataset_service._audio_candidate_score(official, document) is not None


def test_midi_audio_match_compares_note_classes_and_timing(monkeypatch, tmp_path):
    words = [
        {
            "text": str(index),
            "start": float(index),
            "end": float(index + 0.8),
            "notes": [{"note": 60, "start": float(index), "end": float(index + 0.8)}],
        }
        for index in range(1, 26)
    ]
    document = kar_dataset_service.KarDocument(
        title="Song",
        artist="Artist",
        bpm=120,
        key="C",
        duration=30,
        words=words,
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    chroma = __import__("numpy").zeros((12, 400))
    chroma[0] = 1
    fake_librosa = SimpleNamespace(
        load=lambda *_args, **_kwargs: (__import__("numpy").ones(330_750), 11_025),
        feature=SimpleNamespace(
            chroma_cqt=lambda **_kwargs: chroma,
            tempo=lambda **_kwargs: __import__("numpy").array([120.0]),
        ),
    )
    monkeypatch.setitem(sys.modules, "librosa", fake_librosa)

    result = kar_dataset_service._midi_audio_match(document, tmp_path / "preview.wav")

    assert result["score"] == 1
    assert result["compared_notes"] >= 24
    assert result["audio_bpm"] == 120
    assert result["time_scale"] == 1


def test_audio_bpm_resolves_half_tempo_before_scaling():
    assert kar_dataset_service._closest_tempo_octave(64.5, 132) == pytest.approx(129)


def test_batch_endpoint_keeps_per_file_errors(monkeypatch, tmp_path):
    source = build_kar(tmp_path / "song.kar")
    payload = source.read_bytes()
    monkeypatch.setattr(kar_dataset_service, "DATASET_DIR", tmp_path / "dataset")

    def prepare(path, *, original_filename=None):
        if path.read_bytes() == payload:
            assert original_filename == "song.kar"
            return {
                "status": "review",
                "dataset_dir": str(tmp_path / "dataset" / "song"),
                "title": "Test Song",
                "artist": "Artist",
                "word_count": 2,
                "note_count": 2,
                "warnings": [],
            }
        raise AssertionError("unexpected payload")

    monkeypatch.setattr(kar_dataset_service, "prepare_kar_file", prepare)
    result = asyncio.run(
        songs.prepare_kar_training_dataset(
            [upload_file(payload, "song.kar"), upload_file(b"bad", "wrong.txt")]
        )
    )

    assert [item["status"] for item in result["items"]] == ["review", "error"]
    assert result["items"][0]["filename"] == "song.kar"
    assert "только файлы .kar" in result["items"][1]["error"]
