import asyncio
import json
import struct
import sys
import zipfile
from pathlib import Path
from types import SimpleNamespace

import mido
import pytest

from app.routers import songs
from app.services import kar_dataset_service, kfn_dataset_service
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


def build_kfn(path, midi_payload=None):
    songini = (
        b"[General]\nTitle=KFN Song\nArtist=KFN Artist\n"
        b"[Eff1]\nID=2\nSync0=50,100\nTextCount=1\nText0=Hello world\n"
    )
    entries = [("Song.ini", 1, songini)]
    if midi_payload is not None:
        entries.append(("melody.kar", 2, midi_payload))
    header = bytearray(b"KFNB")
    for tag, value in ((b"TITL", b"KFN Song"), (b"ARTS", b"KFN Artist"), (b"FLID", bytes(16))):
        header.extend(tag + b"\x02" + struct.pack("<I", len(value)) + value)
    header.extend(b"ENDH\x01" + struct.pack("<I", 0xFFFFFFFF))
    header.extend(struct.pack("<I", len(entries)))
    payload_offset = 0
    payloads = bytearray()
    for name, kind, payload in entries:
        encoded = name.encode()
        header.extend(struct.pack("<I", len(encoded)) + encoded)
        header.extend(struct.pack("<IIIII", kind, len(payload), payload_offset, len(payload), 0))
        payloads.extend(payload)
        payload_offset += len(payload)
    path.write_bytes(header + payloads)
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


def test_prepares_karaoke_mid_into_the_same_dataset_contract(tmp_path):
    source = build_kar(tmp_path / "song.mid")

    result = kar_dataset_service.prepare_kar_file(
        source,
        output_root=tmp_path / "dataset",
        download_audio=False,
    )

    output = Path(result["dataset_dir"])
    metadata = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
    lyrics = json.loads((output / "lyricsSync.json").read_text(encoding="utf-8"))
    assert result["status"] == "review"
    assert metadata["preparation_mode"] == "mid-reference"
    assert metadata["note_count"] == 2
    assert "mid_sha256" in metadata
    assert lyrics["source"] == "mid"
    assert (output / "source.mid").is_file()


def test_skips_instrumental_mid_without_karaoke_markup(tmp_path):
    source = tmp_path / "instrumental.mid"
    midi = mido.MidiFile(ticks_per_beat=480)
    track = mido.MidiTrack()
    midi.tracks.append(track)
    track.append(mido.Message("note_on", note=60, velocity=90, time=0))
    track.append(mido.Message("note_off", note=60, velocity=0, time=480))
    midi.save(source)

    with pytest.raises(kar_dataset_service.MidiSkipped, match="текст"):
        kar_dataset_service.prepare_kar_file(
            source,
            output_root=tmp_path / "dataset",
            download_audio=False,
        )

    assert not (tmp_path / "dataset").exists()


def test_mid_octave_doubles_are_reduced_to_one_vocal_line(tmp_path):
    source = build_kar(tmp_path / "doubled.mid")
    midi = mido.MidiFile(source, charset="cp1251")
    melody = midi.tracks[1]
    melody.insert(2, mido.Message("note_on", note=48, velocity=80, time=0))
    melody.insert(4, mido.Message("note_off", note=48, velocity=0, time=0))
    midi.save(source)

    document = kar_dataset_service.parse_kar(source)
    notes = [note for word in document.words for note in word["notes"]]

    assert [note["note"] for note in notes] == [60, 62]
    assert all(left["end"] <= right["start"] for left, right in zip(notes, notes[1:], strict=False))


def test_prepares_kfn_into_the_same_dataset_contract(tmp_path):
    midi = build_kar(tmp_path / "embedded.kar").read_bytes()
    source = build_kfn(tmp_path / "song.kfn", midi)

    result = kfn_dataset_service.prepare_kfn_file(source, output_root=tmp_path / "dataset")

    output = Path(result["dataset_dir"])
    metadata = json.loads((output / "metadata.json").read_text(encoding="utf-8"))
    lyrics = json.loads((output / "lyricsSync.json").read_text(encoding="utf-8"))
    comparison = json.loads((output / "comparison.json").read_text(encoding="utf-8"))
    assert result["status"] == "review"
    assert metadata["preparation_mode"] == "kfn-embedded-reference"
    assert metadata["note_count"] == 2
    assert lyrics["source"] == "kfn"
    assert [word["text"] for word in lyrics["words"]] == ["Hello", "world"]
    assert comparison["time_scale"] == 1
    assert (output / "source.kfn").is_file()


def test_prepares_legacy_zip_kfn_with_the_same_logic(tmp_path):
    midi = build_kar(tmp_path / "embedded.kar").read_bytes()
    source = tmp_path / "legacy.kfn"
    with zipfile.ZipFile(source, "w") as archive:
        archive.writestr(
            "Song.ini",
            "[General]\nTitle=ZIP Song\nArtist=ZIP Artist\n"
            "[Eff1]\nID=2\nSync0=50,100\nTextCount=1\nText0=Hello world\n",
        )
        archive.writestr("melody.kar", midi)

    result = kfn_dataset_service.prepare_kfn_file(source, output_root=tmp_path / "dataset")

    assert result["container_variant"] == "ZIP"
    assert result["note_count"] == 2


def test_skips_kfn_without_ready_midi_notes_without_creating_dataset(tmp_path):
    source = build_kfn(tmp_path / "song.kfn")

    with pytest.raises(kfn_dataset_service.KfnSkipped, match="MIDI"):
        kfn_dataset_service.prepare_kfn_file(source, output_root=tmp_path / "dataset")

    assert not (tmp_path / "dataset").exists()


@pytest.mark.parametrize(("name", "payload"), [("song.txt", b"MThd"), ("song.kar", b"bad")])
def test_rejects_unsupported_extension_and_invalid_midi(tmp_path, name, payload):
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


def test_audio_search_uses_performer_embedded_in_midi_title_and_rejects_wrong_duration():
    document = kar_dataset_service.KarDocument(
        title='Король и шут: "Кукла колдуна"',
        artist="Горшенёв М. Князев А.",
        bpm=145,
        key="C",
        duration=204.4,
        words=[],
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    original = {
        "title": "Кукла Колдуна",
        "uploader": "thekorolishut",
        "duration": 204,
    }
    unrelated_early_recording = {
        "title": "Андрей Князев Король и Шут Кукла Колдуна 1991 Рыба",
        "uploader": "Oleksii Khoziaikin",
        "duration": 165,
    }

    assert kar_dataset_service._audio_search_identity(document) == (
        "Король и шут",
        "Кукла колдуна",
    )
    assert kar_dataset_service._audio_candidate_score(original, document) is not None
    assert kar_dataset_service._audio_candidate_score(unrelated_early_recording, document) is None


def test_audio_search_prefers_artist_channel_over_third_party_official_label():
    document = kar_dataset_service.KarDocument(
        title='Король и шут: "Кукла колдуна"',
        artist="Горшенёв М. Князев А.",
        bpm=145,
        key="C",
        duration=204,
        words=[],
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    artist_channel = {
        "title": "Кукла Колдуна",
        "uploader": "thekorolishut",
        "duration": 204,
    }
    reupload = {
        "title": "Король и Шут - Кукла Колдуна [Official Video] HD",
        "uploader": "Random uploader",
        "duration": 202,
    }

    assert kar_dataset_service._audio_candidate_score(
        artist_channel, document
    ) > kar_dataset_service._audio_candidate_score(reupload, document)


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


def test_midi_audio_match_finds_tempo_in_audio_instead_of_trusting_tempo_hint(
    monkeypatch, tmp_path
):
    numpy = __import__("numpy")
    rate, hop = 11_025, 1024
    target_bpm, target_offset = 132.0, 0.4
    words = []
    chroma = numpy.zeros((12, 500))
    pitches = numpy.random.default_rng(42).integers(48, 72, size=30)
    for index, pitch_value in enumerate(pitches, start=1):
        pitch = int(pitch_value)
        start, end = float(index), float(index + 0.7)
        words.append(
            {
                "text": str(index),
                "start": start,
                "end": end,
                "notes": [{"note": pitch, "start": start, "end": end}],
            }
        )
        midpoint = (start + end) / 2
        frame = int((midpoint * 120 / target_bpm + target_offset) * rate / hop)
        chroma[pitch % 12, frame] = 1
    document = kar_dataset_service.KarDocument(
        title="Song",
        artist="Artist",
        bpm=120,
        key="C",
        duration=35,
        words=words,
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    fake_librosa = SimpleNamespace(
        load=lambda *_args, **_kwargs: (numpy.ones(rate * 40), rate),
        feature=SimpleNamespace(
            chroma_cqt=lambda **_kwargs: chroma,
            # Deliberately wrong: the melody/audio match must correct it.
            tempo=lambda **_kwargs: numpy.array([120.0]),
        ),
    )
    monkeypatch.setitem(sys.modules, "librosa", fake_librosa)

    result = kar_dataset_service._midi_audio_match(document, tmp_path / "preview.wav")

    assert result["audio_bpm"] == pytest.approx(target_bpm, abs=0.1)
    assert result["offset_seconds"] == pytest.approx(target_offset, abs=0.1)
    assert result["time_scale"] == pytest.approx(120 / target_bpm, abs=0.001)


def test_midi_audio_match_never_automatically_moves_lyrics_by_multiple_bars(
    monkeypatch, tmp_path
):
    numpy = __import__("numpy")
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
    chroma = numpy.zeros((12, 400))
    # Make the strongest apparent harmony occur far outside the safe lead-in
    # window. The matcher must not shift the authoritative lyric labels there.
    for word in words:
        midpoint = (word["start"] + word["end"]) / 2
        far_frame = int((midpoint - 4) * 11_025 / 1024)
        if 0 <= far_frame < chroma.shape[1]:
            chroma[0, far_frame] = 1
    fake_librosa = SimpleNamespace(
        load=lambda *_args, **_kwargs: (numpy.ones(330_750), 11_025),
        feature=SimpleNamespace(
            chroma_cqt=lambda **_kwargs: chroma,
            tempo=lambda **_kwargs: numpy.array([120.0]),
        ),
    )
    monkeypatch.setitem(sys.modules, "librosa", fake_librosa)

    result = kar_dataset_service._midi_audio_match(document, tmp_path / "preview.wav")

    assert abs(result["offset_seconds"]) <= 1


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


def test_batch_endpoint_dispatches_kfn_and_reports_skipped(monkeypatch, tmp_path):
    monkeypatch.setattr(kar_dataset_service, "DATASET_DIR", tmp_path / "dataset")

    def skip(path, *, original_filename=None):
        assert path.suffix == ".kfn"
        assert original_filename == "song.kfn"
        raise kfn_dataset_service.KfnSkipped("нет готовых нот")

    monkeypatch.setattr(kfn_dataset_service, "prepare_kfn_file", skip)
    result = asyncio.run(songs.prepare_kar_training_dataset([upload_file(b"KFNB", "song.kfn")]))

    assert result["items"] == [
        {
            "filename": "song.kfn",
            "status": "skipped",
            "error": "нет готовых нот",
        }
    ]


def test_batch_endpoint_dispatches_mid_to_midi_preparer(monkeypatch, tmp_path):
    monkeypatch.setattr(kar_dataset_service, "DATASET_DIR", tmp_path / "dataset")

    def prepare(path, *, original_filename=None):
        assert path.suffix == ".mid"
        assert original_filename == "song.mid"
        return {
            "status": "review",
            "dataset_dir": str(tmp_path / "dataset" / "song"),
            "title": "Test Song",
            "artist": "Artist",
            "word_count": 2,
            "note_count": 2,
            "warnings": [],
        }

    monkeypatch.setattr(kar_dataset_service, "prepare_kar_file", prepare)
    result = asyncio.run(songs.prepare_kar_training_dataset([upload_file(b"MThd", "song.mid")]))

    assert result["items"][0]["status"] == "review"
    assert result["items"][0]["filename"] == "song.mid"
