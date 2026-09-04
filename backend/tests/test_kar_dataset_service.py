import asyncio
import io
import json
import struct
import sys
import wave
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


def build_kfn(path, midi_payload=None, audio_payload=None):
    songini = (
        b"[General]\nTitle=KFN Song\nArtist=KFN Artist\n"
        b"[Eff1]\nID=2\nSync0=50,100\nTextCount=1\nText0=Hello world\n"
    )
    entries = [("Song.ini", 1, songini)]
    if midi_payload is not None:
        entries.append(("melody.kar", 2, midi_payload))
    if audio_payload is not None:
        entries.append(("original.mp3", 2, audio_payload))
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


def test_writes_real_embedded_kfn_audio_with_configured_ffmpeg(tmp_path):
    audio = io.BytesIO()
    with wave.open(audio, "wb") as output:
        output.setnchannels(1)
        output.setsampwidth(2)
        output.setframerate(8000)
        output.writeframes(b"\0\0" * 800)
    source = build_kfn(tmp_path / "audio.kfn", audio_payload=audio.getvalue())
    entry = next(item for item in kfn_dataset_service.parse_kfn_container(source).entries
                 if item.name == "original.mp3")
    target = tmp_path / "output"
    target.mkdir()

    assert kfn_dataset_service._write_embedded_audio(entry, target)
    assert (target / "original.flac").stat().st_size > 0


def test_parses_kar_words_tempo_identity_and_melody(tmp_path):
    document = kar_dataset_service.parse_kar(build_kar(tmp_path / "song.kar"))

    assert (document.title, document.artist, document.bpm) == ("Test Song", "Artist", 120)
    assert [word["text"] for word in document.words] == ["Hello", "world"]
    assert document.melody_track == 1
    assert [note["note"] for word in document.words for note in word["notes"]] == [60, 62]


def test_legacy_karmaker_reads_title_and_artist_from_header_track_names(tmp_path):
    source = build_kar(tmp_path / "Batareika.kar")
    midi = mido.MidiFile(source, charset="cp1251")
    lyrics = midi.tracks[0]
    del lyrics[1:3]
    header = mido.MidiTrack(
        [
            mido.MetaMessage("track_name", name="Батарейка", time=0),
            mido.MetaMessage("track_name", name="Жуки", time=0),
            mido.MetaMessage("track_name", name="Жуки", time=0),
            mido.MetaMessage("track_name", name="KAR author", time=0),
        ]
    )
    midi.tracks.insert(0, header)
    midi.save(source)

    document = kar_dataset_service.parse_kar(source, original_filename=source.name)

    assert (document.title, document.artist) == ("Батарейка", "Жуки")
    assert kar_dataset_service._audio_search_queries(*kar_dataset_service._audio_search_identity(document))[0][1] == (
        "Жуки Батарейка Topic"
    )


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


def test_legacy_karmaker_signed_lyric_preroll_does_not_create_a_years_long_song():
    messages = [
        SimpleNamespace(time=0xFFFFF141),
        SimpleNamespace(time=413),
        SimpleNamespace(time=2979),
        SimpleNamespace(time=383),
        SimpleNamespace(time=3264),
    ]

    tracks = kar_dataset_service._track_events(SimpleNamespace(tracks=[messages]))

    assert [tick for tick, _message in tracks[0]] == [-3775, -3362, -383, 0, 3264]


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


def test_equally_aligned_tracks_prefer_vocal_density_over_repeating_accompaniment():
    lyric_onsets = [0.0, 1.0, 2.0, 3.0]
    vocal_notes = []
    accompaniment_notes = []
    for onset in lyric_onsets:
        vocal_notes.extend(
            [
                {"note": 60, "start": onset, "end": onset + 0.4, "velocity": 90},
                {"note": 62, "start": onset + 0.4, "end": onset + 0.8, "velocity": 90},
            ]
        )
        accompaniment_notes.extend(
            {
                "note": 48 + index % 4,
                "start": onset + index * 0.1,
                "end": onset + index * 0.1 + 0.09,
                "velocity": 80,
            }
            for index in range(8)
        )

    track, notes = kar_dataset_service._select_melody_track(
        [
            (1, "Song title", vocal_notes),
            (4, "Arrangement by author", accompaniment_notes),
        ],
        lyric_track=2,
        lyric_start=0,
        lyric_end=4,
        lyric_onsets=lyric_onsets,
    )

    assert track == 1
    assert notes == vocal_notes


def test_kar_melody_notes_are_owned_once_without_clipping(tmp_path):
    document = kar_dataset_service.parse_kar(build_kar(tmp_path / "song.kar"))
    notes = [note for word in document.words for note in word["notes"]]

    assert notes == [
        {"note": 60, "start": 0.5, "end": 1.0},
        {"note": 62, "start": 1.0, "end": 1.5},
    ]


def test_kar_word_keeps_syllable_events_and_drops_trailing_lyric_silence():
    words, _text = kar_dataset_service._word_events(
        [
            {"time": 1.0, "text": "\\при"},
            {"time": 1.2, "text": "вет "},
            {"time": 2.0, "text": "мир "},
        ],
        2.5,
    )
    kar_dataset_service._attach_notes(
        words,
        [
            {"note": 60, "start": 0.8, "end": 1.55},
            {"note": 62, "start": 2.0, "end": 2.4},
        ],
    )
    kar_dataset_service._tighten_word_ends_to_notes(words)

    assert words[0] == {
        "text": "привет",
        "start": 1.0,
        "end": 1.55,
        "notes": [{"note": 60, "start": 1.0, "end": 1.55}],
        "syllables": [
            {"text": "при", "start": 1.0, "end": 1.2},
            {"text": "вет", "start": 1.2, "end": 1.55},
        ],
    }


def test_kar_event_that_finishes_one_word_and_starts_another_keeps_valid_syllables():
    words, _text = kar_dataset_service._word_events(
        [
            {"time": 1.0, "text": "при"},
            {"time": 1.2, "text": "вет мир "},
            {"time": 2.0, "text": "снова "},
        ],
        2.5,
    )

    assert words[0]["end"] == 2.0
    assert words[0]["syllables"][-1] == {"text": "вет", "start": 1.2, "end": 2.0}
    kar_dataset_service.validate_lyrics_document(
        {"bpm": 120, "key": "C", "words": words, "source": "kar"}
    )


def test_kar_attached_note_is_clipped_to_its_owner_word():
    words = [{"text": "word", "start": 1.0, "end": 2.0, "notes": []}]

    count = kar_dataset_service._attach_notes(
        words,
        [{"note": 64, "start": 0.5, "end": 2.5}],
    )

    assert count == 1
    assert words[0]["notes"] == [{"note": 64, "start": 1.0, "end": 2.0}]


def test_composite_kar_title_keeps_credits_out_of_song_identity(tmp_path):
    source = build_kar(tmp_path / "song.kar")
    midi = mido.MidiFile(source, charset="cp1251")
    midi.tracks[0][1].text = "@TБеспечный ангел - Ария"
    midi.tracks[0][2].text = "@TGolden Earring Пушкина М."
    midi.save(source)

    document = kar_dataset_service.parse_kar(source)

    assert (document.artist, document.title) == ("Ария", "Беспечный ангел")


def test_performer_in_quoted_kar_title_replaces_composer_credits(tmp_path):
    source = build_kar(tmp_path / "song.kar")
    midi = mido.MidiFile(source, charset="cp1251")
    midi.tracks[0][1].text = '@TКороль и Шут: "Кукла колдуна"'
    midi.tracks[0][2].text = "@TГоршенёв М., Князев А."
    midi.save(source)

    document = kar_dataset_service.parse_kar(source)

    assert (document.artist, document.title) == ("Король и Шут", "Кукла колдуна")


def test_colon_in_a_regular_song_title_is_not_assumed_to_contain_a_performer():
    assert kar_dataset_service.normalize_karaoke_identity(
        "Chapter: Part One",
        "Existing Artist",
    ) == ("Chapter: Part One", "Existing Artist")


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


def test_prepares_kar_directly_inside_an_existing_song_directory(tmp_path):
    source = build_kar(tmp_path / "upload.kar")
    target = tmp_path / "karaoke_songs" / "Artist Test Song"
    target.mkdir(parents=True)

    result = kar_dataset_service.prepare_kar_file(
        source,
        original_filename="Artist - Test Song.kar",
        output_root=target.parent,
        target_dir=target,
        download_audio=False,
    )

    assert Path(result["dataset_dir"]) == target.resolve()
    assert (target / "source.kar").read_bytes() == source.read_bytes()
    assert (target / "lyricsSync.json").is_file()


def test_prepares_karaoke_mid_into_the_same_dataset_contract(tmp_path):
    source = build_kar(tmp_path / "song.mid")
    midi = mido.MidiFile(source, charset="cp1251")
    midi.tracks[0].append(mido.MetaMessage("lyrics", text="/Second ", time=240))
    midi.tracks[0].append(mido.MetaMessage("lyrics", text="line ", time=240))
    midi.save(source)

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
    assert lyrics["text"] == "Hello world\nSecond line"
    assert [word["text"] for word in lyrics["words"]] == [
        "Hello",
        "world",
        "Second",
        "line",
    ]
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


def test_kar_overlapping_melody_notes_are_reduced_to_one_vocal_line(tmp_path):
    source = build_kar(tmp_path / "doubled.kar")
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


def test_kfn_embedded_original_is_split_into_training_stems(monkeypatch, tmp_path):
    midi = build_kar(tmp_path / "embedded.kar").read_bytes()
    source = build_kfn(tmp_path / "song.kfn", midi, b"embedded audio")

    def write_audio(_entry, target):
        (target / "original.flac").write_bytes(b"original")
        return True

    def separate(target):
        (target / "vocals.flac").write_bytes(b"vocals")
        (target / "instrumental.flac").write_bytes(b"instrumental")
        return True

    monkeypatch.setattr(kfn_dataset_service, "_write_embedded_audio", write_audio)
    monkeypatch.setattr(kar_dataset_service, "_prepare_fast_stems", separate)
    monkeypatch.setattr(
        kar_dataset_service,
        "_midi_audio_match",
        lambda *_args, **_kwargs: {
            "score": 0.9,
            "kar_bpm": 120,
            "audio_bpm": 120,
            "detected_audio_bpm": 120,
            "time_scale": 1,
            "offset_seconds": 6.25,
            "pitch_shift_semitones": 0,
            "audio_duration": 20,
            "compared_notes": 50,
        },
    )
    monkeypatch.setattr(
        kar_dataset_service.metadata_enrichment_service,
        "prepare_training_media",
        lambda *_args, **_kwargs: {
            "cover_status": "ready",
            "video_status": "ready",
            "video_id": "video-id",
            "warnings": [],
        },
    )

    result = kfn_dataset_service.prepare_kfn_file(source, output_root=tmp_path / "dataset")
    output = Path(result["dataset_dir"])

    assert result["status"] == "ready"
    assert result["stems_status"] == "ready"
    assert result["alignment"]["status"] == "vocal-stem-refined"
    assert result["alignment"]["offset_seconds"] == 6.15
    assert (output / "original.flac").read_bytes() == b"original"
    assert (output / "vocals.flac").read_bytes() == b"vocals"
    assert (output / "instrumental.flac").read_bytes() == b"instrumental"


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

    def separate(output):
        (output / "vocals.flac").write_bytes(b"vocals")
        (output / "instrumental.flac").write_bytes(b"instrumental")
        return True

    monkeypatch.setattr(kar_dataset_service, "_download_audio", download)
    monkeypatch.setattr(kar_dataset_service, "_prepare_fast_stems", separate)
    monkeypatch.setattr(
        kar_dataset_service.metadata_enrichment_service,
        "prepare_training_media",
        lambda *_args, **_kwargs: {
            "cover_status": "ready",
            "video_status": "ready",
            "video_id": "video-id",
            "warnings": [],
        },
    )
    result = kar_dataset_service.prepare_kar_file(source, output_root=tmp_path / "dataset")
    output = Path(result["dataset_dir"])
    reference = json.loads((output / "lyricsSync.json").read_text(encoding="utf-8"))

    assert result["status"] == "ready"
    assert result["preparation_mode"] == "kar-with-original-audio-bpm"
    assert result["stems_status"] == "ready"
    assert reference["bpm"] == 100
    assert reference["words"][0]["start"] == pytest.approx(0.6)
    assert reference["words"][0]["notes"][0]["start"] == pytest.approx(0.6)
    assert reference["words"][1]["end"] == pytest.approx(1.8)
    assert result["alignment"]["status"] == "audio-bpm-applied"
    assert result["alignment"]["offset_seconds"] == 0
    assert not (output / "lyricsSync.kar.raw.json").exists()
    assert (output / "vocals.flac").read_bytes() == b"vocals"
    assert (output / "instrumental.flac").read_bytes() == b"instrumental"


def test_vocal_stem_refines_long_intro_before_writing_lyrics(monkeypatch, tmp_path):
    source = build_kar(tmp_path / "song.kar")
    original_match = {
        "score": 0.8,
        "kar_bpm": 120,
        "audio_bpm": 120,
        "detected_audio_bpm": 120,
        "time_scale": 1,
        "offset_seconds": 1,
        "pitch_shift_semitones": 0,
        "audio_duration": 20,
        "compared_notes": 50,
    }
    vocal_match = {**original_match, "score": 0.95, "offset_seconds": 6.25}

    def download(_document, output):
        (output / "original.flac").write_bytes(b"audio")
        return {"midi_audio_match": original_match}

    def separate(output):
        (output / "vocals.flac").write_bytes(b"vocals")
        (output / "instrumental.flac").write_bytes(b"instrumental")
        return True

    def match(_document, audio_path, *, max_offset_seconds=1):
        assert audio_path.name == "vocals.flac"
        assert max_offset_seconds >= 6.25
        return vocal_match

    monkeypatch.setattr(kar_dataset_service, "_download_audio", download)
    monkeypatch.setattr(kar_dataset_service, "_prepare_fast_stems", separate)
    monkeypatch.setattr(kar_dataset_service, "_midi_audio_match", match)
    monkeypatch.setattr(
        kar_dataset_service.metadata_enrichment_service,
        "prepare_training_media",
        lambda *_args, **_kwargs: {
            "cover_status": "ready",
            "video_status": "ready",
            "video_id": "video-id",
            "warnings": [],
        },
    )

    result = kar_dataset_service.prepare_kar_file(source, output_root=tmp_path / "dataset")
    output = Path(result["dataset_dir"])
    reference = json.loads((output / "lyricsSync.json").read_text(encoding="utf-8"))

    assert reference["words"][0]["start"] == pytest.approx(6.65)
    assert result["alignment"]["status"] == "vocal-stem-refined"
    assert result["alignment"]["offset_seconds"] == 6.15
    assert result["audio_source"]["midi_audio_match"]["offset_seconds"] == 6.15


def test_vocal_refinement_corrects_a_late_midi_match_to_the_nearby_vocal_attack(
    monkeypatch, tmp_path
):
    source = build_kar(tmp_path / "song.kar")
    vocal_match = {
        "score": 0.95,
        "kar_bpm": 120,
        "audio_bpm": 120,
        "detected_audio_bpm": 120,
        "time_scale": 1,
        "offset_seconds": 6.25,
        "pitch_shift_semitones": 0,
        "audio_duration": 20,
        "compared_notes": 50,
    }
    monkeypatch.setattr(
        kar_dataset_service,
        "_midi_audio_match",
        lambda *_args, **_kwargs: vocal_match,
    )
    monkeypatch.setattr(
        kar_dataset_service,
        "_nearby_vocal_attack_seconds",
        lambda _path, _predicted: 6.0,
    )

    refined = kar_dataset_service._refine_vocal_alignment(
        source,
        source.name,
        "kar",
        tmp_path / "vocals.flac",
        {"midi_audio_match": vocal_match},
    )

    assert refined is not None
    document, _reference, comparison, _audio_source = refined
    assert document.words[0]["start"] == pytest.approx(6.0)
    assert comparison["offset_seconds"] == pytest.approx(5.5)
    assert comparison["vocal_attack_correction_seconds"] == pytest.approx(0.65)


def test_nearby_vocal_attack_requires_quiet_then_sustained_voice(monkeypatch, tmp_path):
    rate = 1_000
    samples = __import__("numpy").zeros(rate * 5, dtype="float32")
    samples[2_000:2_500] = 0.2
    monkeypatch.setattr(
        kar_dataset_service,
        "_read_mono_audio",
        lambda _path: (samples, rate),
    )

    assert kar_dataset_service._nearby_vocal_attack_seconds(
        tmp_path / "vocals.flac", 2.8
    ) == pytest.approx(2.0, abs=0.04)

    samples[:] = 0.2
    assert kar_dataset_service._nearby_vocal_attack_seconds(
        tmp_path / "vocals.flac", 2.8
    ) is None


def test_vocal_refinement_uses_raw_midi_tempo_when_original_mix_match_is_wrong(
    monkeypatch, tmp_path
):
    source = build_kar(tmp_path / "song.kar")
    original_match = {
        "score": 0.8,
        "kar_bpm": 120,
        "audio_bpm": 105,
        "detected_audio_bpm": 105,
        "time_scale": 120 / 105,
        "offset_seconds": -0.5,
        "pitch_shift_semitones": -5,
        "audio_duration": 20,
        "compared_notes": 50,
    }
    vocal_match = {
        **original_match,
        "score": 0.9,
        "audio_bpm": 118,
        "time_scale": 120 / 118,
        "offset_seconds": 1.5,
        "pitch_shift_semitones": 0,
    }
    monkeypatch.setattr(
        kar_dataset_service,
        "_midi_audio_match",
        lambda *_args, **_kwargs: vocal_match,
    )

    refined = kar_dataset_service._refine_vocal_alignment(
        source,
        source.name,
        "kar",
        tmp_path / "vocals.flac",
        {"midi_audio_match": original_match},
    )

    assert refined is not None
    document, _reference, comparison, audio_source = refined
    assert document.bpm == 118
    assert comparison["status"] == "vocal-stem-refined"
    assert comparison["offset_seconds"] == pytest.approx(1.4)
    assert audio_source["midi_audio_match"]["audio_bpm"] == 118


def test_symbolic_reprocessing_reuses_audio_and_preserves_midi_notes(monkeypatch, tmp_path):
    source = build_kar(tmp_path / "song.kar")
    target = tmp_path / "ready-song"
    target.mkdir()
    for name in ("original.flac", "vocals.flac", "instrumental.flac"):
        (target / name).write_bytes(name.encode())
    (target / "clip.mp4").write_bytes(b"clip")
    (target / "cover.jpg").write_bytes(b"cover")

    def match(_document, audio_path, **_kwargs):
        return {
            "score": 0.9,
            "kar_bpm": 120,
            "audio_bpm": 120,
            "detected_audio_bpm": 120,
            "time_scale": 1,
            "offset_seconds": 1.5 if audio_path.name == "vocals.flac" else 0,
            "pitch_shift_semitones": 0,
            "audio_duration": 20,
            "compared_notes": 50,
        }

    monkeypatch.setattr(kar_dataset_service, "_midi_audio_match", match)
    monkeypatch.setattr(
        kar_dataset_service,
        "_download_audio",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("existing original must be reused")
        ),
    )
    monkeypatch.setattr(
        kar_dataset_service,
        "_prepare_fast_stems",
        lambda *_args, **_kwargs: (_ for _ in ()).throw(
            AssertionError("existing stems must be reused")
        ),
    )

    result = kar_dataset_service.prepare_kar_file(
        source,
        target_dir=target,
        reuse_existing_audio=True,
    )
    reference = json.loads((target / "lyricsSync.json").read_text(encoding="utf-8"))

    assert result["status"] == "ready"
    assert result["stems_status"] == "ready"
    assert result["alignment"]["status"] == "vocal-stem-refined"
    assert sum(len(word["notes"]) for word in reference["words"]) == 2
    assert reference["words"][0]["start"] == pytest.approx(1.9)
    assert (target / "clip.mp4").read_bytes() == b"clip"


def test_vocal_refinement_rejects_offset_that_clamps_opening_lyrics(monkeypatch, tmp_path):
    source = build_kar(tmp_path / "song.kar")
    original_match = {
        "score": 0.8,
        "kar_bpm": 120,
        "audio_bpm": 120,
        "detected_audio_bpm": 120,
        "time_scale": 1,
        "offset_seconds": 0.2,
        "pitch_shift_semitones": 0,
        "audio_duration": 20,
        "compared_notes": 50,
    }
    false_repeated_phrase_match = {
        **original_match,
        "score": 0.95,
        "offset_seconds": -7.5,
    }

    def download(_document, output):
        (output / "original.flac").write_bytes(b"audio")
        return {"midi_audio_match": original_match}

    def separate(output):
        (output / "vocals.flac").write_bytes(b"vocals")
        (output / "instrumental.flac").write_bytes(b"instrumental")
        return True

    monkeypatch.setattr(kar_dataset_service, "_download_audio", download)
    monkeypatch.setattr(kar_dataset_service, "_prepare_fast_stems", separate)
    monkeypatch.setattr(
        kar_dataset_service,
        "_midi_audio_match",
        lambda *_args, **_kwargs: false_repeated_phrase_match,
    )
    monkeypatch.setattr(
        kar_dataset_service.metadata_enrichment_service,
        "prepare_training_media",
        lambda *_args, **_kwargs: {
            "cover_status": "ready",
            "video_status": "ready",
            "video_id": "video-id",
            "warnings": [],
        },
    )

    result = kar_dataset_service.prepare_kar_file(source, output_root=tmp_path / "dataset")
    output = Path(result["dataset_dir"])
    reference = json.loads((output / "lyricsSync.json").read_text(encoding="utf-8"))

    assert reference["words"][0]["start"] > 0
    assert result["alignment"]["status"] == "audio-bpm-applied"
    assert result["alignment"]["offset_seconds"] == 0.2


def test_fast_stems_are_staged_before_becoming_dataset_files(monkeypatch, tmp_path):
    target = tmp_path / "song"
    target.mkdir()
    (target / "original.flac").write_bytes(b"original")

    def separate(source, vocals, instrumental):
        assert source == target / "original.flac"
        assert vocals.parent.name == ".stems-processing"
        vocals.write_bytes(b"vocals")
        instrumental.write_bytes(b"instrumental")

    monkeypatch.setattr(kar_dataset_service.ai_bridge, "separate_training_stems", separate)

    assert kar_dataset_service._prepare_fast_stems(target) is True
    assert (target / "vocals.flac").read_bytes() == b"vocals"
    assert (target / "instrumental.flac").read_bytes() == b"instrumental"
    assert not (target / ".stems-processing").exists()


def test_stem_failure_preserves_downloaded_original_and_marks_dataset(monkeypatch, tmp_path):
    source = build_kar(tmp_path / "song.kar")

    def download(_document, output):
        (output / "original.flac").write_bytes(b"audio")
        return {
            "midi_audio_match": {
                "score": 0.9,
                "kar_bpm": 120,
                "audio_bpm": 120,
                "detected_audio_bpm": 120,
                "time_scale": 1,
                "offset_seconds": 0,
                "pitch_shift_semitones": 0,
                "audio_duration": 2,
                "compared_notes": 50,
            }
        }

    monkeypatch.setattr(kar_dataset_service, "_download_audio", download)
    monkeypatch.setattr(
        kar_dataset_service,
        "_prepare_fast_stems",
        lambda _target: (_ for _ in ()).throw(RuntimeError("separator failed")),
    )
    monkeypatch.setattr(
        kar_dataset_service.metadata_enrichment_service,
        "prepare_training_media",
        lambda *_args, **_kwargs: {
            "cover_status": "fallback",
            "video_status": "fallback",
            "video_id": None,
            "warnings": [],
        },
    )

    result = kar_dataset_service.prepare_kar_file(source, output_root=tmp_path / "dataset")
    output = Path(result["dataset_dir"])

    assert result["status"] == "ready"
    assert result["stems_status"] == "error"
    assert (output / "original.flac").read_bytes() == b"audio"
    assert any("separator failed" in warning for warning in result["warnings"])


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


def test_audio_search_rejects_plain_cover_marker_from_real_failed_selection():
    document = kar_dataset_service.KarDocument(
        title="Батарейка",
        artist="Жуки",
        bpm=74.5,
        key="C",
        duration=234,
        words=[],
        lyric_track=2,
        melody_track=1,
        raw_lyrics=[],
    )
    wrong_recording = {
        "title": 'POL8 - Batareika (Cover) - "Батарейка" в Германии!',
        "uploader": "Andrej Plattner",
        "duration": 253,
    }

    assert kar_dataset_service._audio_candidate_score(wrong_recording, document) is None


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


def test_audio_search_accepts_full_title_from_a_label_channel_for_melody_verification():
    document = kar_dataset_service.KarDocument(
        title="Половинка",
        artist="Танцы Минус",
        bpm=88,
        key="C",
        duration=169,
        words=[],
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    label_upload = {"title": "Половинка", "uploader": "Music Distributor", "duration": 171}

    assert kar_dataset_service._audio_candidate_score(label_upload, document) is not None


def test_audio_search_ignores_corrupt_trailing_midi_duration():
    document = kar_dataset_service.KarDocument(
        title="Батарейка",
        artist="Жуки",
        bpm=75,
        key="C",
        duration=9_008_118,
        words=[{"text": "слово", "start": 10.0, "end": 218.0, "notes": []}],
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    studio = {"title": "Жуки Батарейка", "uploader": "Жуки", "duration": 224}

    assert kar_dataset_service._reliable_document_duration(document) == 218.0
    assert kar_dataset_service._audio_candidate_score(studio, document) is not None


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


def test_audio_search_allows_moderate_duration_drift_only_for_verified_artist_source():
    document = kar_dataset_service.KarDocument(
        title="Мечта",
        artist="Люмен",
        bpm=120,
        key="C",
        duration=213.713,
        words=[],
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    artist_studio_release = {
        "title": "Мечта",
        "uploader": "Lumen",
        "channel": "Lumen",
        "duration": 265,
    }
    unverified_reupload = {
        **artist_studio_release,
        "uploader": "Random Music Archive",
        "channel": "Random Music Archive",
    }
    implausibly_long_upload = {
        **artist_studio_release,
        "duration": 420,
    }
    live_release = {
        **artist_studio_release,
        "title": "Мечта (Live)",
    }

    # The strict MIDI-to-audio matcher downstream remains the authority.  A
    # trusted artist release may contain a longer intro/outro than the .kar.
    assert kar_dataset_service._audio_candidate_score(artist_studio_release, document) is not None
    assert kar_dataset_service._audio_candidate_score(unverified_reupload, document) is None
    assert kar_dataset_service._audio_candidate_score(implausibly_long_upload, document) is None
    assert kar_dataset_service._audio_candidate_score(live_release, document) is None


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


def test_audio_search_artist_channel_beats_unverified_studio_query_result():
    document = kar_dataset_service.KarDocument(
        title="Батарейка",
        artist="Жуки",
        bpm=74.5,
        key="C",
        duration=234,
        words=[],
        lyric_track=2,
        melody_track=1,
        raw_lyrics=[],
    )
    artist_channel = {
        "title": "Жуки - Батарейка",
        "uploader": "группа Жуки",
        "duration": 234,
        "_karaoke_search_intent": "official",
        "_karaoke_search_rank": 0,
    }
    music_school = {
        "title": "Жуки: Батарейка | СТУДИЯ АРТИС",
        "uploader": "Школа музыки Артис",
        "duration": 234,
        "_karaoke_search_intent": "studio",
        "_karaoke_search_rank": 0,
    }

    assert kar_dataset_service._audio_candidate_score(
        artist_channel, document
    ) > kar_dataset_service._audio_candidate_score(music_school, document)


def test_audio_search_prefers_studio_query_over_hidden_live_album():
    document = kar_dataset_service.KarDocument(
        title="Лесник",
        artist="Король и Шут",
        bpm=145,
        key="C",
        duration=193,
        words=[],
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    hidden_live_release = {
        "title": "Лесник",
        "uploader": "thekorolishut",
        "album": "Ели мясо мужики (Deluxe Edition)",
        "duration": 193,
        "_karaoke_search_intent": "official",
        "_karaoke_search_rank": 0,
    }
    studio_release = {
        "title": "Лесник",
        "uploader": "thekorolishut",
        "album": "Будь как дома, Путник...",
        "duration": 192,
        "_karaoke_search_intent": "studio",
        "_karaoke_search_rank": 0,
    }

    assert kar_dataset_service._audio_candidate_score(
        studio_release, document
    ) > kar_dataset_service._audio_candidate_score(hidden_live_release, document)


def test_audio_search_rejects_live_markers_hidden_in_expanded_metadata():
    document = kar_dataset_service.KarDocument(
        title="Song",
        artist="Artist",
        bpm=120,
        key="C",
        duration=180,
        words=[],
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    candidate = {
        "title": "Artist - Song",
        "uploader": "Artist",
        "album": "Greatest Hits",
        "description": "Recorded live at the city concert hall",
        "duration": 180,
    }

    assert kar_dataset_service._audio_candidate_score(candidate, document) is None


def test_audio_search_rejects_unverified_reupload_from_real_failed_selection():
    document = kar_dataset_service.KarDocument(
        title="Самба белого мотылька",
        artist="Меладзе Валерий",
        bpm=250,
        key="C",
        duration=260,
        words=[],
        lyric_track=2,
        melody_track=1,
        raw_lyrics=[],
    )
    concert_reupload_without_live_markers = {
        "title": "В. Меладзе - Самбо белого мотылька.",
        "uploader": "Reporter Kazan",
        "channel": "Reporter Kazan",
        "duration": 261,
        "webpage_url": "https://www.youtube.com/watch?v=xIjS5A3s73w",
    }

    # Matching title, duration and melody are insufficient: a random channel
    # can upload a concert recording without writing "live" in its metadata.
    assert kar_dataset_service._audio_candidate_score(
        concert_reupload_without_live_markers, document
    ) is not None
    assert not kar_dataset_service._audio_candidate_has_studio_provenance(
        concert_reupload_without_live_markers, document
    )
    assert kar_dataset_service._audio_candidate_studio_provenance_strength(
        concert_reupload_without_live_markers, document
    ) == 0


def test_audio_search_accepts_distributor_topic_metadata_as_studio_provenance():
    document = kar_dataset_service.KarDocument(
        title="Самба белого мотылька",
        artist="Валерий Меладзе",
        bpm=250,
        key="C",
        duration=260,
        words=[],
        lyric_track=2,
        melody_track=1,
        raw_lyrics=[],
    )
    topic_release = {
        "title": "Самба белого мотылька",
        "uploader": "Valeriy Meladze - Topic",
        "channel": "Valeriy Meladze - Topic",
        "track": "Самба белого мотылька",
        "artist": "Валерий Меладзе",
        "album": "Всё так и было",
        "duration": 260,
    }

    assert kar_dataset_service._audio_candidate_has_studio_provenance(
        topic_release, document
    )
    assert kar_dataset_service._audio_candidate_studio_provenance_strength(
        topic_release, document
    ) == 2


def test_audio_melody_threshold_relaxes_only_for_structured_studio_release():
    assert kar_dataset_service._audio_candidate_melody_verified(0.42, provenance=2)
    assert not kar_dataset_service._audio_candidate_melody_verified(0.42, provenance=1)
    assert not kar_dataset_service._audio_candidate_melody_verified(0.39, provenance=2)


def test_audio_consensus_accepts_two_matching_independent_copies_and_rejects_cover():
    def candidate(video_id, uploader, score, pitch_shift, duration):
        entry = {"id": video_id, "uploader": uploader, "duration": duration}
        match = {
            "score": score,
            "pitch_shift_semitones": pitch_shift,
            "audio_bpm": 123.9,
            "time_scale": 1.0089,
            "offset_seconds": 0.45,
            "audio_duration": duration,
        }
        return (50.0, entry, entry, match, 0)

    first = candidate("first", "Uploader A", 0.628, 0, 187.1)
    second = candidate("second", "Uploader B", 0.577, 0, 186.5)
    cover = candidate("cover", "Uploader C", 0.564, -6, 184.8)

    accepted = kar_dataset_service._audio_consensus_matches([first, second, cover])

    assert first in accepted
    assert second in accepted
    assert cover not in accepted


def test_audio_consensus_requires_independent_uploaders_and_strong_midi_match():
    base_match = {
        "score": 0.62,
        "pitch_shift_semitones": 0,
        "audio_bpm": 124.0,
        "time_scale": 1.0,
        "offset_seconds": 0.4,
        "audio_duration": 187.0,
    }
    first = (50.0, {"id": "one", "uploader": "Same"}, {}, base_match, 0)
    same_uploader = (49.0, {"id": "two", "uploader": "Same"}, {}, base_match, 0)
    weak = (
        48.0,
        {"id": "three", "uploader": "Other"},
        {},
        {**base_match, "score": 0.49},
        0,
    )

    assert kar_dataset_service._audio_consensus_matches([first, same_uploader, weak]) == []


def test_known_library_identity_overrides_composer_credits_from_midi():
    document = kar_dataset_service.KarDocument(
        title="Выхода нет",
        artist="Васильев",
        bpm=120,
        key="C",
        duration=228,
        words=[],
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )

    kar_dataset_service._apply_known_identity(
        document, title="Выхода нет", artist="Сплин"
    )

    assert kar_dataset_service._audio_search_identity(document) == ("Сплин", "Выхода нет")


def test_audio_search_ranks_distributor_release_above_artist_channel_video():
    document = kar_dataset_service.KarDocument(
        title="Самба белого мотылька",
        artist="Меладзе Валерий",
        bpm=250,
        key="C",
        duration=260,
        words=[],
        lyric_track=2,
        melody_track=1,
        raw_lyrics=[],
    )
    artist_channel_video = {
        "title": "Валерий Меладзе - Самба белого мотылька",
        "uploader": "meladzeofficial",
        "duration": 239,
    }
    distributor_release = {
        "title": "Самба белого мотылька",
        "uploader": "meladzeofficial",
        "artist": "Валерий Меладзе",
        "track": "Самба белого мотылька",
        "duration": 240,
    }

    assert kar_dataset_service._audio_candidate_studio_provenance_strength(
        distributor_release, document
    ) > kar_dataset_service._audio_candidate_studio_provenance_strength(
        artist_channel_video, document
    )


def test_audio_search_merges_queries_and_keeps_studio_intent():
    shared = {"id": "abcdefghijk", "title": "Artist - Song", "duration": 180}

    entries = kar_dataset_service._merge_audio_search_entries(
        [
            ("official", {"entries": [shared]}),
            ("studio", {"entries": [shared, {"id": "other-video", "title": "Other"}]}),
        ]
    )

    by_id = {entry["id"]: entry for entry in entries}
    assert by_id["abcdefghijk"]["_karaoke_search_intent"] == "studio"
    assert by_id["abcdefghijk"]["_karaoke_search_rank"] == 0


def test_audio_search_keeps_artist_and_title_in_one_natural_query():
    assert kar_dataset_service._audio_search_queries("Танцы Минус", "Половинка") == [
        ("release", "Танцы Минус Половинка Topic"),
        ("official", "Танцы Минус Половинка official audio"),
        ("studio", "Танцы Минус Половинка studio version"),
    ]


def test_audio_search_identity_removes_wrapping_karaoke_punctuation():
    document = kar_dataset_service.KarDocument(
        title='"Самба белого мотылька"',
        artist="Меладзе Валерий",
        bpm=250,
        key="C",
        duration=260,
        words=[],
        lyric_track=2,
        melody_track=1,
        raw_lyrics=[],
    )

    assert kar_dataset_service._audio_search_identity(document) == (
        "Меладзе Валерий",
        "Самба белого мотылька",
    )
    assert kar_dataset_service._audio_search_queries(
        *kar_dataset_service._audio_search_identity(document)
    )[1][1] == "Меладзе Валерий Самба белого мотылька official audio"


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


def test_midi_audio_match_can_measure_a_long_intro_on_an_isolated_vocal(
    monkeypatch, tmp_path
):
    numpy = __import__("numpy")
    rate, hop = 11_025, 1024
    target_offset = 6.25
    pitches = numpy.random.default_rng(84).integers(48, 72, size=36)
    words = []
    chroma = numpy.zeros((12, 650))
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
        frame = int((midpoint + target_offset) * rate / hop)
        chroma[pitch % 12, frame] = 1
    document = kar_dataset_service.KarDocument(
        title="Song",
        artist="Artist",
        bpm=120,
        key="C",
        duration=45,
        words=words,
        lyric_track=0,
        melody_track=1,
        raw_lyrics=[],
    )
    fake_librosa = SimpleNamespace(
        load=lambda *_args, **_kwargs: (numpy.ones(rate * 55), rate),
        feature=SimpleNamespace(
            chroma_cqt=lambda **_kwargs: chroma,
            tempo=lambda **_kwargs: numpy.array([120.0]),
        ),
    )
    monkeypatch.setitem(sys.modules, "librosa", fake_librosa)

    result = kar_dataset_service._midi_audio_match(
        document,
        tmp_path / "vocals.flac",
        max_offset_seconds=12,
    )

    assert result["offset_seconds"] == pytest.approx(target_offset, abs=0.1)


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
