"""Prepare supervised karaoke-training examples from MIDI karaoke files."""

from __future__ import annotations

import hashlib
import logging
import math
import os
import re
import shutil
import subprocess
from bisect import bisect_right
from collections.abc import Callable
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import mido
import numpy as np

import config
from AI.lyrics_document import validate_lyrics_document
from app.services import ai_bridge, kar_metadata, metadata_enrichment_service, song_service
from app.services.kar_alignment import (
    closest_tempo_octave as _closest_tempo_octave,
    midi_audio_match as _midi_audio_match,
)
from app.utils.json_files import write_json

try:
    from yt_dlp import YoutubeDL
except ImportError:  # pragma: no cover - lightweight API-only installations
    YoutubeDL = None


logger = logging.getLogger(__name__)
DATASET_DIR = config.DATA_DIR / "kar-training-dataset"
MAX_KAR_BYTES = 8 * 1024 * 1024
SUPPORTED_KARAOKE_MIDI_SUFFIXES = {".kar", ".mid"}
WORD_NOTE_TRAILING_SILENCE_SECONDS = 0.18
DatasetProgress = Callable[[str, float, str], None]
CancelCallback = Callable[[], bool]


class MidiSkipped(ValueError):
    """A valid MIDI file that does not contain reliable karaoke markup."""


def _notify_dataset(
    progress: DatasetProgress | None,
    cancelled: CancelCallback | None,
    stage: str,
    percent: float,
    detail: str,
) -> None:
    if callable(cancelled) and cancelled():
        raise RuntimeError("Подготовка песни отменена")
    if callable(progress):
        progress(stage, percent, detail)


_REJECTED_AUDIO_HINTS = (
    "karaoke",
    "lyrics",
    "lyric video",
    "instrumental",
    "isolated vocal",
    "isolated vocals",
    "acapella",
    "a cappella",
    "cover version",
    "cover by",
    "cover",
    "tribute",
    "reaction",
    "remix",
    "slowed",
    "nightcore",
    "8d audio",
    "караоке",
    "минус",
    "изолированный вокал",
    "только вокал",
    "текст песни",
    "кавер",
    "demo",
    "live",
    "live performance",
    "live session",
    "concert",
    "unplugged",
    "rehearsal",
    "minecraft",
    "демо",
    "концерт",
    "живой звук",
    "живое исполнение",
    "выступление",
    "фестиваль",
    "репетиция",
    "акустическая версия",
    "майнкрафт",
)
_MAX_AUDIO_DURATION_DRIFT_SECONDS = 20.0
_MAX_AUDIO_DURATION_DRIFT_RATIO = 0.12
_MAX_TRUSTED_AUDIO_DURATION_DRIFT_RATIO = 0.35
_MIN_MELODY_MATCH_SCORE = 0.45
_MIN_STRUCTURED_RELEASE_MELODY_MATCH_SCORE = 0.40
_MIN_CONSENSUS_MELODY_MATCH_SCORE = 0.55
_MAX_VOCAL_AUDIO_OFFSET_SECONDS = 15.0
_VOCAL_DISPLAY_LEAD_SECONDS = 0.1
_AUDIO_SEARCH_INTENT_BONUS = {
    "release": 4.0,
    "studio": 2.0,
    "official": 1.0,
}
_CYRILLIC_TRANSLITERATION = str.maketrans(
    {
        "а": "a",
        "б": "b",
        "в": "v",
        "г": "g",
        "ґ": "g",
        "д": "d",
        "е": "e",
        "ё": "e",
        "є": "e",
        "ж": "zh",
        "з": "z",
        "и": "i",
        "і": "i",
        "ї": "i",
        "й": "y",
        "к": "k",
        "л": "l",
        "м": "m",
        "н": "n",
        "о": "o",
        "п": "p",
        "р": "r",
        "с": "s",
        "т": "t",
        "у": "u",
        "ф": "f",
        "х": "h",
        "ц": "ts",
        "ч": "ch",
        "ш": "sh",
        "щ": "sch",
        "ъ": "",
        "ы": "y",
        "ь": "",
        "э": "e",
        "ю": "yu",
        "я": "ya",
    }
)


@dataclass(slots=True)
class KarDocument:
    title: str
    artist: str
    bpm: float
    key: str
    duration: float
    words: list[dict[str, Any]]
    lyric_track: int
    melody_track: int | None
    raw_lyrics: list[dict[str, Any]]
    text: str = ""


def _clean_text(value: str) -> str:
    return " ".join(str(value or "").replace("\x00", "").split())


def _load_midi(path: Path) -> mido.MidiFile:
    try:
        return mido.MidiFile(path, charset="cp1251", clip=True)
    except (OSError, ValueError, EOFError):
        return mido.MidiFile(path, charset="latin1", clip=True)


def _track_events(midi: mido.MidiFile) -> list[list[tuple[int, mido.Message]]]:
    tracks: list[list[tuple[int, mido.Message]]] = []
    for track in midi.tracks:
        tick = 0
        events = []
        for message in track:
            delta = int(message.time)
            tick += delta - (0x100000000 if not events and delta > 0x7FFFFFFF else 0)
            events.append((tick, message))
        tracks.append(events)
    return tracks
def _tempo_converter(
    tracks: list[list[tuple[int, mido.Message]]],
    ticks_per_beat: int,
    *,
    bpm_override: float | None = None,
    offset_seconds: float = 0.0,
):
    # MIDI defaults to 120 BPM only when the file has no tempo event yet.
    # Building a list and sorting ``(tick, tempo)`` tuples made a real event
    # at tick 0 compete with the synthetic default by its numeric tempo value;
    # for 132 BPM (454545 us) the later-sorted 500000 default won and stretched
    # the entire KAR timeline by 10%.
    by_tick: dict[int, int] = {0: 500_000}
    for track in tracks:
        for tick, message in track:
            if message.type == "set_tempo":
                by_tick[tick] = int(message.tempo)
    if bpm_override is not None:
        if not math.isfinite(bpm_override) or bpm_override <= 0:
            raise ValueError("BPM оригинальной песни должен быть положительным числом")
        original_initial_tempo = by_tick[0]
        replacement_initial_tempo = 60_000_000 / bpm_override
        tempo_scale = replacement_initial_tempo / original_initial_tempo
        by_tick = {tick: round(tempo * tempo_scale) for tick, tempo in by_tick.items()}
    ticks, seconds, tempos = [], [], []
    elapsed, previous_tick, previous_tempo = 0.0, 0, 500_000
    for tick, tempo in sorted(by_tick.items()):
        elapsed += mido.tick2second(tick - previous_tick, ticks_per_beat, previous_tempo)
        ticks.append(tick)
        seconds.append(elapsed)
        tempos.append(tempo)
        previous_tick, previous_tempo = tick, tempo

    def convert(tick: int) -> float:
        index = max(0, bisect_right(ticks, tick) - 1)
        value = seconds[index] + mido.tick2second(
            tick - ticks[index], ticks_per_beat, tempos[index]
        )
        return max(0.0, value + offset_seconds)

    return convert, tempos[0]


def _metadata(tracks: list[list[tuple[int, mido.Message]]]) -> tuple[str, str, str]:
    return kar_metadata.metadata(tracks)


def _lyrics_by_track(
    tracks: list[list[tuple[int, mido.Message]]], convert
) -> tuple[int, list[dict[str, Any]]]:
    candidates = []
    for index, track in enumerate(tracks):
        events = []
        for tick, message in track:
            if message.type not in {"lyrics", "text"}:
                continue
            text = str(getattr(message, "text", ""))
            if not text.strip() or text.lstrip().startswith("@"):
                continue
            events.append({"time": convert(tick), "text": text})
        if events:
            lyric_events = sum(1 for _tick, message in track if message.type == "lyrics")
            candidates.append((lyric_events * 10_000 + len(events), index, events))
    if not candidates:
        raise ValueError("В .kar не найдены события текста/lyrics")
    _score, index, events = max(candidates, key=lambda item: item[0])
    return index, events


def _word_events(
    events: list[dict[str, Any]], duration: float
) -> tuple[list[dict[str, Any]], str]:
    words: list[dict[str, Any]] = []
    lines: list[list[str]] = []
    line_words: list[str] = []
    current_text = ""
    current_start = 0.0
    current_end = 0.0
    current_syllables: list[dict[str, Any]] = []

    def flush() -> None:
        nonlocal current_text, current_start, current_end, current_syllables
        text = current_text.strip()
        if text:
            end = max(current_start + 0.04, current_end)
            word = {
                "text": text,
                "start": round(current_start, 3),
                "end": round(end, 3),
                "notes": [],
            }
            if len(current_syllables) > 1:
                word["syllables"] = [dict(syllable) for syllable in current_syllables]
            words.append(word)
            line_words.append(text)
        current_text = ""
        current_syllables = []

    def finish_line() -> None:
        flush()
        if line_words:
            lines.append(list(line_words))
            line_words.clear()

    for index, event in enumerate(events):
        start = float(event["time"])
        end = (
            float(events[index + 1]["time"])
            if index + 1 < len(events)
            else min(max(duration, start + 0.35), start + 2.5)
        )
        raw_event = str(event["text"]).replace("\r\n", "\n").replace("\r", "\n")
        for segment_index, segment in enumerate(raw_event.split("\n")):
            line_break = segment_index > 0 or segment.startswith(("\\", "/"))
            raw = segment.lstrip("\\/")
            if line_break:
                finish_line()
            parts = re.split(r"(\s+)", raw)
            for part in parts:
                if not part:
                    continue
                if part.isspace():
                    flush()
                    continue
                if not current_text:
                    current_start = start
                current_text += part
                current_end = end
                rounded_start, rounded_end = round(start, 3), round(max(start + 0.001, end), 3)
                if (
                    current_syllables
                    and current_syllables[-1]["start"] == rounded_start
                    and current_syllables[-1]["end"] == rounded_end
                ):
                    current_syllables[-1]["text"] += part
                else:
                    current_syllables.append(
                        {"text": part, "start": rounded_start, "end": rounded_end}
                    )
            if raw.endswith((" ", "\t")):
                flush()
    finish_line()
    if not words:
        raise ValueError("В .kar найден текст, но не удалось выделить слова")
    for index, word in enumerate(words[:-1]):
        clipped_end = max(word["start"] + 0.04, min(word["end"], words[index + 1]["start"]))
        # A single MIDI lyric event can finish this word and begin the next.
        # Both pieces then share the event interval, so clipping solely to the
        # next word's start would leave a preserved syllable outside its word.
        syllable_end = max(
            (float(item["end"]) for item in word.get("syllables", [])),
            default=clipped_end,
        )
        word["end"] = round(max(clipped_end, syllable_end), 3)
    return words, "\n".join(" ".join(line) for line in lines)


def _notes_by_track(
    tracks: list[list[tuple[int, mido.Message]]], convert
) -> list[tuple[int, str, list[dict[str, Any]]]]:
    results = []
    for track_index, track in enumerate(tracks):
        active: dict[tuple[int, int], list[tuple[int, int]]] = {}
        notes, name = [], ""
        last_tick = track[-1][0] if track else 0
        for tick, message in track:
            if message.type == "track_name":
                name = _clean_text(getattr(message, "name", ""))
            if message.type == "note_on" and message.velocity > 0 and message.channel != 9:
                active.setdefault((message.channel, message.note), []).append(
                    (tick, int(message.velocity))
                )
            elif message.type in {"note_off", "note_on"} and message.channel != 9:
                stack = active.get((message.channel, message.note))
                if not stack:
                    continue
                start_tick, velocity = stack.pop(0)
                if tick > start_tick:
                    notes.append(
                        {
                            "note": int(message.note),
                            "start": convert(start_tick),
                            "end": convert(tick),
                            "velocity": velocity,
                        }
                    )
        for (_channel, note), starts in active.items():
            for start_tick, velocity in starts:
                if last_tick > start_tick:
                    notes.append(
                        {
                            "note": note,
                            "start": convert(start_tick),
                            "end": convert(last_tick),
                            "velocity": velocity,
                        }
                    )
        if notes:
            results.append((track_index, name, sorted(notes, key=lambda item: item["start"])))
    return results


def _select_melody_track(
    candidates: list[tuple[int, str, list[dict[str, Any]]]],
    lyric_track: int,
    lyric_start: float,
    lyric_end: float,
    lyric_onsets: list[float] | None = None,
) -> tuple[int | None, list[dict[str, Any]]]:
    ranked = []
    for track_index, name, notes in candidates:
        relevant = [
            note
            for note in notes
            if note["end"] > lyric_start and note["start"] < lyric_end and 35 <= note["note"] <= 100
        ]
        if not relevant:
            continue
        overlap = sum(
            max(0.0, min(note["end"], lyric_end) - max(note["start"], lyric_start))
            for note in relevant
        )
        # An explicitly labelled vocal/melody track is authoritative.  Dense
        # accompaniment tracks can contain thousands of overlapping notes;
        # their raw note count/coverage must never outweigh the MIDI label.
        hint = 100_000 if re.search(r"vocal|voice|melody|lead|sing|вокал|мелод", name, re.I) else 0
        same_track = 45 if track_index == lyric_track else 0
        median_pitch = float(np.median([note["note"] for note in relevant]))
        range_bonus = 25 if 48 <= median_pitch <= 84 else 0
        onset_ratio = 0.0
        if lyric_onsets:
            note_starts = [float(note["start"]) for note in relevant]
            matched = sum(
                any(abs(start - onset) <= 0.06 for start in note_starts) for onset in lyric_onsets
            )
            onset_ratio = matched / len(lyric_onsets)
        # When two tracks begin exactly with every lyric event, the denser one
        # is commonly a quantized guitar/keyboard pattern rather than vocals.
        # A normal vocal melody averages roughly one to three note attacks per
        # word; penalize only the excess so genuine melismas remain possible.
        notes_per_word = len(relevant) / max(1, len(lyric_onsets or []))
        density_penalty = max(0.0, notes_per_word - 3.0) * 100
        ranked.append(
            (
                hint
                + same_track
                + range_bonus
                + min(len(relevant), 120)
                + overlap
                + onset_ratio * 20_000,
                -density_penalty,
                track_index,
                relevant,
            )
        )
    if not ranked:
        return None, []
    _score, _density, track_index, notes = max(
        ranked, key=lambda item: (item[0] + item[1], item[0])
    )
    return track_index, notes


def _attach_notes(words: list[dict[str, Any]], notes: list[dict[str, Any]]) -> int:
    count = 0
    for note in notes:
        owners = [
            (
                max(
                    0.0,
                    min(float(word["end"]), float(note["end"]))
                    - max(float(word["start"]), float(note["start"])),
                ),
                index,
            )
            for index, word in enumerate(words)
        ]
        overlap, owner = max(owners, default=(0.0, -1))
        if owner < 0 or overlap <= 0:
            continue
        word = words[owner]
        clipped_start = max(float(word["start"]), float(note["start"]))
        clipped_end = min(float(word["end"]), float(note["end"]))
        if round(clipped_end, 3) <= round(clipped_start, 3):
            continue
        word["notes"].append(
            {
                "note": int(note["note"]),
                "start": round(clipped_start, 3),
                "end": round(clipped_end, 3),
            }
        )
        count += 1
    return count


def _tighten_word_ends_to_notes(words: list[dict[str, Any]]) -> None:
    """Remove lyric-event silence after the final attached note of each word."""
    for word in words:
        notes = word.get("notes", [])
        if not notes:
            continue
        old_end = float(word["end"])
        note_end = max(float(note["end"]) for note in notes)
        if old_end - note_end <= WORD_NOTE_TRAILING_SILENCE_SECONDS:
            continue
        syllables = word.get("syllables", [])
        if syllables and note_end <= float(syllables[-1]["start"]):
            # Conflicting MIDI tracks: do not collapse a visible syllable to a
            # zero-length interval merely because the selected note ended early.
            continue
        new_end = round(max(float(word["start"]) + 0.04, note_end), 3)
        word["end"] = new_end
        if syllables:
            syllables[-1]["end"] = new_end
        clipped = []
        for note in notes:
            start = max(float(word["start"]), float(note["start"]))
            end = min(new_end, float(note["end"]))
            if round(end, 3) > round(start, 3):
                clipped.append({**note, "start": round(start, 3), "end": round(end, 3)})
        word["notes"] = clipped


def _monophonize_notes(notes: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Collapse octave doubles/chords into one continuous vocal line."""
    groups: list[list[dict[str, Any]]] = []
    for note in sorted(notes, key=lambda item: (item["start"], item["end"], -item["velocity"])):
        if groups and abs(float(note["start"]) - float(groups[-1][0]["start"])) <= 0.01:
            groups[-1].append(note)
        else:
            groups.append([note])

    selected: list[dict[str, Any]] = []
    previous_pitch: int | None = None
    for group in groups:
        if previous_pitch is None:
            chosen = max(group, key=lambda item: (item["velocity"], item["note"]))
        else:
            anchor_pitch = previous_pitch
            chosen = min(
                group,
                key=lambda item: (
                    abs(int(item["note"]) - anchor_pitch),
                    -int(item["velocity"]),
                    -int(item["note"]),
                ),
            )
        selected.append(dict(chosen))
        previous_pitch = int(chosen["note"])

    normalized: list[dict[str, Any]] = []
    for note in selected:
        if normalized and float(note["start"]) < float(normalized[-1]["end"]):
            normalized[-1]["end"] = float(note["start"])
            if normalized[-1]["end"] - normalized[-1]["start"] < 0.02:
                normalized.pop()
        normalized.append(note)
    return normalized


def parse_kar(
    path: str | Path,
    *,
    original_filename: str | None = None,
    bpm_override: float | None = None,
    offset_seconds: float = 0.0,
) -> KarDocument:
    source = Path(path)
    suffix = source.suffix.casefold()
    if suffix not in SUPPORTED_KARAOKE_MIDI_SUFFIXES:
        raise ValueError("Поддерживаются только файлы .kar и .mid")
    if source.stat().st_size > MAX_KAR_BYTES:
        raise ValueError(f"Файл {suffix} превышает допустимый размер 8 МБ")
    if source.read_bytes()[:4] != b"MThd":
        raise ValueError("Файл не является корректным MIDI/KAR")
    midi = _load_midi(source)
    tracks = _track_events(midi)
    convert, initial_tempo = _tempo_converter(
        tracks,
        midi.ticks_per_beat,
        bpm_override=bpm_override,
        offset_seconds=offset_seconds,
    )
    title, artist, key = _metadata(tracks)
    filename_artist, filename_title = song_service.parse_filename_identity(
        original_filename or source.name
    )
    title = title or filename_title
    artist = artist or filename_artist or ""
    title, artist = normalize_karaoke_identity(title, artist)
    lyric_track, lyric_events = _lyrics_by_track(tracks, convert)
    track_duration = max((convert(track[-1][0]) for track in tracks if track), default=0.0)
    words, text = _word_events(lyric_events, track_duration)
    candidates = _notes_by_track(tracks, convert)
    melody_track, notes = _select_melody_track(
        candidates,
        lyric_track,
        words[0]["start"],
        words[-1]["end"],
        [float(word["start"]) for word in words],
    )
    notes = _monophonize_notes(notes)
    if notes:
        last = words[-1]
        sustained = [
            note["end"] for note in notes if last["start"] <= note["start"] <= last["end"] + 0.5
        ]
        if sustained:
            last["end"] = round(max(last["end"], max(sustained)), 3)
    _attach_notes(words, notes)
    _tighten_word_ends_to_notes(words)
    duration = max(
        track_duration,
        words[-1]["end"],
        max((note["end"] for note in notes), default=0.0),
    )
    return KarDocument(
        title=title,
        artist=artist,
        bpm=round(60_000_000 / initial_tempo, 3),
        key=key,
        duration=round(duration, 3),
        words=words,
        lyric_track=lyric_track,
        melody_track=melody_track,
        raw_lyrics=lyric_events,
        text=text,
    )


def _normalized_words(value: str) -> list[str]:
    normalized = str(value or "").casefold().translate(_CYRILLIC_TRANSLITERATION)
    return re.findall(r"[a-z0-9]+", normalized)


def _similar_word(left: str, right: str) -> bool:
    def aliases(value: str) -> set[str]:
        return {
            value,
            value.replace("iya", "ia").replace("ya", "ia"),
            value.replace("iy", "i").replace("yy", "y"),
        }

    for first in aliases(left):
        for second in aliases(right):
            if first == second:
                return True
            if min(len(first), len(second)) >= 4 and (first in second or second in first):
                return True
            if SequenceMatcher(a=first, b=second, autojunk=False).ratio() >= 0.78:
                return True
    return False


def _overlap_count(expected: set[str], candidate: set[str]) -> int:
    return sum(any(_similar_word(word, value) for value in candidate) for word in expected)


def _audio_search_identity(document: KarDocument) -> tuple[str, str]:
    """Return performer/title even when MIDI stores composers as the artist.

    A common Russian karaoke tag is ``Performer: "Song"`` in the title while
    the artist field contains the songwriters. Searching by that artist field
    selected unrelated solo/demo recordings. In that layout the title itself
    is the more reliable source of both values.
    """
    title, artist = normalize_karaoke_identity(document.title, document.artist)
    return artist, title


def _looks_like_person_credits(value: str) -> bool:
    """Recognize composer/author credits that are commonly stored as artist."""
    cleaned = " ".join(str(value or "").split())
    if not cleaned:
        return False
    has_initials = bool(re.search(r"(?:^|\s)[A-ZА-ЯЁ]\.(?:\s|,|$)", cleaned))
    multiple_names = bool(re.search(r"[,;/&]", cleaned))
    return has_initials or multiple_names


def normalize_karaoke_identity(title: str, artist: str | None) -> tuple[str, str]:
    """Return canonical ``(title, performer)`` from inconsistent karaoke tags."""
    wrapping = "\"'«»“”„ _"
    clean_title = _clean_text(title).strip(wrapping)
    clean_artist = _clean_text(artist or "").strip(wrapping)
    match = re.match(r"^(.+?)\s*[:：]\s*(.+)$", clean_title)
    if not match:
        return clean_title, clean_artist
    embedded_artist = _clean_text(match.group(1)).strip("\"'«»“”„ ")
    raw_song = match.group(2).strip()
    embedded_title = _clean_text(raw_song).strip("\"'«»“”„ ")
    quoted_song = bool(raw_song[:1] in "\"'«“„" and raw_song[-1:] in "\"'»”")
    artist_matches_prefix = bool(
        clean_artist
        and set(_normalized_words(clean_artist)) & set(_normalized_words(embedded_artist))
    )
    if (
        embedded_artist
        and embedded_title
        and (
            quoted_song
            or not clean_artist
            or _looks_like_person_credits(clean_artist)
            or artist_matches_prefix
        )
    ):
        return embedded_title, embedded_artist
    return clean_title, clean_artist


def _duration_matches(document: KarDocument, duration: float) -> bool:
    expected_duration = _reliable_document_duration(document)
    if not duration or not expected_duration:
        return True
    maximum_drift = max(
        _MAX_AUDIO_DURATION_DRIFT_SECONDS,
        expected_duration * _MAX_AUDIO_DURATION_DRIFT_RATIO,
    )
    return abs(duration - expected_duration) <= maximum_drift


def _reliable_document_duration(document: KarDocument) -> float:
    """Ignore corrupt trailing MIDI ticks while retaining normal outros."""
    duration = max(0.0, float(document.duration or 0))
    lyric_end = max(
        (float(word.get("end") or 0) for word in document.words),
        default=0.0,
    )
    if lyric_end and duration > lyric_end + max(90.0, lyric_end * 0.5):
        return lyric_end
    return max(duration, lyric_end)


def _audio_candidate_score(entry: dict[str, Any], document: KarDocument) -> float | None:
    title = str(entry.get("title") or "")
    # Flat search results often hide the only evidence that a recording is
    # live in the album/description fields. Score the expanded metadata too
    # once yt-dlp has fetched it, instead of trusting the visible title alone.
    metadata_text = " ".join(
        str(entry.get(field) or "")
        for field in ("title", "album", "description", "playlist_title")
    )
    normalized = metadata_text.casefold()
    if kar_metadata.contains_hint(normalized, _REJECTED_AUDIO_HINTS):
        return None
    expected_artist, expected_song = _audio_search_identity(document)
    expected_title = set(_normalized_words(expected_song))
    candidate = set(_normalized_words(title))
    title_overlap = _overlap_count(expected_title, candidate)
    if expected_title and title_overlap < max(1, math.ceil(len(expected_title) / 2)):
        return None
    artist_words = {word for word in _normalized_words(expected_artist) if len(word) > 1}
    uploader_words = set(_normalized_words(entry.get("uploader") or ""))
    searchable = candidate | uploader_words
    artist_overlap = _overlap_count(artist_words, searchable)
    # Distributor/label channels often expose only the complete song title.
    # Let those candidates reach the stricter MIDI-melody verification.
    if artist_words and not artist_overlap and title_overlap < len(expected_title):
        return None
    duration = float(entry.get("duration") or 0)
    expected_duration = _reliable_document_duration(document)
    duration_penalty = abs(duration - expected_duration) if duration and expected_duration else 0
    if not _duration_matches(document, duration):
        # A MIDI/KAR arrangement can omit a long studio intro, outro or an
        # instrumental section.  Permit that moderate drift only when the
        # expanded metadata proves that the source belongs to the performer;
        # the chroma matcher below remains responsible for verifying that it
        # is the same composition.  Unverified re-uploads keep the strict
        # duration gate so this cannot reintroduce concert recordings.
        trusted_duration_drift = (
            duration
            and expected_duration
            and duration_penalty / expected_duration
            <= _MAX_TRUSTED_AUDIO_DURATION_DRIFT_RATIO
            and _audio_candidate_has_studio_provenance(entry, document)
        )
        if not trusted_duration_drift:
            return None
    uploader_overlap = _overlap_count(artist_words, uploader_words)
    official = 8 if any(hint in normalized for hint in ("official", "audio", "music video")) else 0
    search_intent = str(entry.get("_karaoke_search_intent") or "")
    search_rank = max(0, int(entry.get("_karaoke_search_rank") or 0))
    intent_bonus = _AUDIO_SEARCH_INTENT_BONUS.get(search_intent, 0.0)
    return (
        title_overlap * 20
        + artist_overlap * 12
        + uploader_overlap * 14
        + official
        + intent_bonus
        - min(search_rank, 12) * 0.35
        - duration_penalty / 3
    )


def _audio_candidate_studio_provenance_strength(
    entry: dict[str, Any], document: KarDocument
) -> int:
    """Require positive ownership/release evidence after metadata expansion.

    Title, duration and MIDI melody can identify the composition, but cannot
    distinguish the studio master from an unlabeled concert re-upload.  Only
    trust an upload when its channel matches the performer or YouTube exposes
    matching structured track/artist metadata from a music distributor.
    """
    expected_artist, expected_song = _audio_search_identity(document)
    artist_words = {word for word in _normalized_words(expected_artist) if len(word) > 1}
    title_words = set(_normalized_words(expected_song))
    if not artist_words or not title_words:
        return 0

    displayed_title = set(_normalized_words(entry.get("title") or ""))
    track_title = set(_normalized_words(entry.get("track") or ""))
    candidate_title = track_title or displayed_title
    required_title_overlap = max(1, math.ceil(len(title_words) / 2))
    if _overlap_count(title_words, candidate_title) < required_title_overlap:
        return 0

    channel_words = set(
        _normalized_words(
            " ".join(
                str(entry.get(field) or "")
                for field in ("uploader", "channel", "uploader_id", "channel_id")
            )
        )
    )
    required_artist_overlap = max(1, math.ceil(len(artist_words) / 2))
    release_artist_words = set(
        _normalized_words(
            " ".join(
                str(entry.get(field) or "")
                for field in ("artist", "artists", "creator", "release_artist")
            )
        )
    )
    if (
        track_title
        and _overlap_count(artist_words, release_artist_words) >= required_artist_overlap
    ):
        return 2
    if _overlap_count(artist_words, channel_words) >= required_artist_overlap:
        return 1
    return 0


def _audio_candidate_has_studio_provenance(
    entry: dict[str, Any], document: KarDocument
) -> bool:
    return _audio_candidate_studio_provenance_strength(entry, document) > 0


def _audio_candidate_melody_verified(score: float, *, provenance: int) -> bool:
    threshold = (
        _MIN_STRUCTURED_RELEASE_MELODY_MATCH_SCORE
        if provenance >= 2
        else _MIN_MELODY_MATCH_SCORE
    )
    return score >= threshold


def _audio_consensus_matches(matches: list[tuple]) -> list[tuple]:
    """Trust an unlabelled studio master only when independent copies agree."""

    def uploader(item: tuple) -> str:
        entry, expanded = item[1], item[2]
        value = " ".join(
            str((expanded or entry).get(field) or entry.get(field) or "")
            for field in ("uploader", "channel", "uploader_id", "channel_id")
        )
        return " ".join(_normalized_words(value))

    def same_recording(left: tuple, right: tuple) -> bool:
        left_match, right_match = left[3], right[3]
        if left_match.get("pitch_shift_semitones") != right_match.get(
            "pitch_shift_semitones"
        ):
            return False
        left_duration = float(left_match.get("audio_duration") or 0)
        right_duration = float(right_match.get("audio_duration") or 0)
        if not left_duration or not right_duration:
            return False
        if abs(left_duration - right_duration) > max(
            3.0, min(left_duration, right_duration) * 0.02
        ):
            return False
        left_bpm = float(left_match.get("audio_bpm") or 0)
        right_bpm = float(right_match.get("audio_bpm") or 0)
        if not left_bpm or not right_bpm or abs(left_bpm - right_bpm) > 1.5:
            return False
        return (
            abs(
                float(left_match.get("time_scale") or 0)
                - float(right_match.get("time_scale") or 0)
            )
            <= 0.015
            and abs(
                float(left_match.get("offset_seconds") or 0)
                - float(right_match.get("offset_seconds") or 0)
            )
            <= 1.0
        )

    eligible = [
        item
        for item in matches
        if item[4] == 0
        and float(item[3].get("score") or 0) >= _MIN_CONSENSUS_MELODY_MATCH_SCORE
        and uploader(item)
    ]
    accepted: list[tuple] = []
    for item in eligible:
        item_uploader = uploader(item)
        if any(
            uploader(peer) != item_uploader and same_recording(item, peer)
            for peer in eligible
            if peer is not item
        ):
            accepted.append(item)
    return accepted


def _apply_known_identity(
    document: KarDocument, *, title: str | None, artist: str | None
) -> KarDocument:
    """Prefer the library identity over composer credits embedded in MIDI."""
    if str(title or "").strip():
        document.title = _clean_text(str(title))
    if str(artist or "").strip():
        document.artist = _clean_text(str(artist))
    return document


def _audio_search_queries(artist: str, title: str) -> list[tuple[str, str]]:
    identity = " ".join(part for part in (artist, title) if part)
    return [
        ("release", f"{identity} Topic"),
        ("official", f"{identity} official audio"),
        ("studio", f"{identity} studio version"),
    ]


def _merge_audio_search_entries(results: list[tuple[str, dict[str, Any]]]) -> list[dict[str, Any]]:
    """Deduplicate searches while retaining the strongest search intent."""
    merged: dict[str, dict[str, Any]] = {}
    for intent, result in results:
        entries = result.get("entries", []) if isinstance(result, dict) else []
        for rank, raw_entry in enumerate(entries):
            if not isinstance(raw_entry, dict):
                continue
            entry = dict(raw_entry)
            key = str(entry.get("id") or _candidate_url(entry) or "")
            if not key:
                continue
            entry["_karaoke_search_intent"] = intent
            entry["_karaoke_search_rank"] = rank
            previous = merged.get(key)
            if previous is None or _AUDIO_SEARCH_INTENT_BONUS.get(
                intent, 0
            ) > _AUDIO_SEARCH_INTENT_BONUS.get(
                str(previous.get("_karaoke_search_intent") or ""), 0
            ):
                merged[key] = entry
    return list(merged.values())


def _candidate_url(entry: dict[str, Any]) -> str | None:
    value = entry.get("webpage_url") or entry.get("url") or entry.get("id")
    if not value:
        return None
    value = str(value)
    return (
        f"https://www.youtube.com/watch?v={value}" if re.fullmatch(r"[\w-]{11}", value) else value
    )


def _download_preview(entry: dict[str, Any], directory: Path, index: int) -> tuple[Path, dict]:
    webpage = _candidate_url(entry)
    if not webpage:
        raise RuntimeError("Источник аудио не содержит адрес")
    stem = directory / f"preview-{index}"
    options = {
        "format": "worstaudio/worst",
        "outtmpl": f"{stem}.%(ext)s",
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "socket_timeout": 30,
        "retries": 2,
    }
    with YoutubeDL(options) as downloader:
        info = downloader.extract_info(webpage, download=True)
    sources = [path for path in directory.glob(f"{stem.name}.*") if path.is_file()]
    if not sources:
        raise RuntimeError("Не удалось скачать аудиопредпросмотр")
    source = max(sources, key=lambda path: path.stat().st_size)
    preview = directory / f"preview-{index}.wav"
    result = subprocess.run(
        [
            str(config.FFMPEG_EXE),
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-ar",
            "11025",
            "-ac",
            "1",
            str(preview),
        ],
        capture_output=True,
        check=False,
        timeout=5 * 60,
    )
    source.unlink(missing_ok=True)
    if result.returncode or not preview.is_file():
        raise RuntimeError("FFmpeg не смог подготовить аудиопредпросмотр")
    return preview, info


def _download_audio(document: KarDocument, output_dir: Path) -> dict[str, Any]:
    if YoutubeDL is None:
        raise RuntimeError("yt-dlp не установлен")
    expected_artist, expected_title = _audio_search_identity(document)
    queries = _audio_search_queries(expected_artist, expected_title)
    search_options = {
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "extract_flat": "in_playlist",
        "skip_download": True,
        "socket_timeout": 20,
        "retries": 2,
    }
    with YoutubeDL(search_options) as downloader:
        search_results = [
            (intent, downloader.extract_info(f"ytsearch10:{query}", download=False))
            for intent, query in queries
        ]
    entries = _merge_audio_search_entries(search_results)
    ranked = [
        (score, entry)
        for entry in entries
        if isinstance(entry, dict)
        and (score := _audio_candidate_score(entry, document)) is not None
    ]
    if not ranked:
        raise RuntimeError("Не найдена оригинальная запись, достаточно похожая на данные .kar")
    temporary = output_dir / ".download"
    temporary.mkdir(parents=True, exist_ok=True)
    matches = []
    for index, (_metadata_score, entry) in enumerate(
        sorted(ranked, key=lambda item: item[0], reverse=True)[:4]
    ):
        try:
            preview, preview_info = _download_preview(entry, temporary, index)
            preview_info = {
                **preview_info,
                "_karaoke_search_intent": entry.get("_karaoke_search_intent"),
                "_karaoke_search_rank": entry.get("_karaoke_search_rank"),
            }
            expanded_score = _audio_candidate_score(preview_info, document)
            if expanded_score is None:
                continue
            match = _midi_audio_match(document, preview)
            provenance = _audio_candidate_studio_provenance_strength(preview_info, document)
            matches.append((expanded_score, entry, preview_info, match, provenance))
        except Exception as exc:
            logger.warning(
                "Audio candidate verification failed: id=%s title=%r error=%s",
                entry.get("id"),
                entry.get("title"),
                exc,
            )
            continue
        finally:
            (temporary / f"preview-{index}.wav").unlink(missing_ok=True)
    if not matches:
        shutil.rmtree(temporary, ignore_errors=True)
        raise RuntimeError("Не удалось проверить найденные аудиозаписи по мелодии .kar")
    provenance_verified = [
        item
        for item in matches
        if item[4] > 0
        if _audio_candidate_melody_verified(item[3]["score"], provenance=item[4])
    ]
    verified_matches = provenance_verified or _audio_consensus_matches(matches)
    if not verified_matches:
        shutil.rmtree(temporary, ignore_errors=True)
        best_match = max(matches, key=lambda item: item[3]["score"])[3]
        raise RuntimeError(
            "Найденные записи не совпадают с мелодией .kar "
            f"(лучшее совпадение {best_match['score']:.0%})"
        )
    # Once the MIDI melody has verified candidates, prefer the strongest
    # performer/title/source metadata. Tiny chroma-score differences between
    # copies of the same master must not make a random re-upload beat the
    # performer's own channel.
    _metadata_score, selected, preview_info, match, selected_provenance = max(
        verified_matches,
        key=lambda item: (item[4], item[0], item[3]["score"]),
    )
    selected_by_consensus = selected_provenance <= 0
    webpage = _candidate_url(selected)
    options = {
        "format": "bestaudio/best",
        "outtmpl": str(temporary / "source.%(ext)s"),
        "noplaylist": True,
        "quiet": True,
        "no_warnings": True,
        "noprogress": True,
        "socket_timeout": 30,
        "retries": 3,
    }
    with YoutubeDL(options) as downloader:
        info = downloader.extract_info(str(webpage), download=True)
    candidates = [path for path in temporary.glob("source.*") if path.is_file()]
    if not candidates:
        raise RuntimeError("yt-dlp завершился без аудиофайла")
    source = max(candidates, key=lambda path: path.stat().st_size)
    target = output_dir / "original.flac"
    result = subprocess.run(
        [
            str(config.FFMPEG_EXE),
            "-hide_banner",
            "-loglevel",
            "error",
            "-nostdin",
            "-y",
            "-i",
            str(source),
            "-vn",
            "-ar",
            "44100",
            "-ac",
            "2",
            "-c:a",
            "flac",
            str(target),
        ],
        capture_output=True,
        check=False,
        timeout=20 * 60,
    )
    if result.returncode or not target.is_file():
        shutil.rmtree(temporary, ignore_errors=True)
        detail = result.stderr.decode("utf-8", errors="ignore").strip()
        raise RuntimeError(f"FFmpeg не смог подготовить original.flac: {detail[-500:]}")
    # The preview is only used to select a candidate. The authoritative BPM and
    # final mapping must come from the complete downloaded original recording.
    match = _midi_audio_match(document, target)
    final_entry = {
        **info,
        "title": info.get("title") or selected.get("title"),
        "uploader": info.get("uploader") or selected.get("uploader"),
        "duration": info.get("duration") or selected.get("duration"),
        "_karaoke_search_intent": selected.get("_karaoke_search_intent"),
        "_karaoke_search_rank": selected.get("_karaoke_search_rank"),
    }
    if _audio_candidate_score(final_entry, document) is None:
        target.unlink(missing_ok=True)
        shutil.rmtree(temporary, ignore_errors=True)
        raise RuntimeError(
            "Скачанная запись не совпадает с исполнителем, названием или длительностью .kar"
        )
    final_provenance = _audio_candidate_studio_provenance_strength(final_entry, document)
    if final_provenance <= 0 and not selected_by_consensus:
        target.unlink(missing_ok=True)
        shutil.rmtree(temporary, ignore_errors=True)
        raise RuntimeError("Источник аудио не подтверждён как выпуск исполнителя")
    final_match_verified = (
        float(match["score"]) >= _MIN_CONSENSUS_MELODY_MATCH_SCORE
        if selected_by_consensus
        else _audio_candidate_melody_verified(match["score"], provenance=final_provenance)
    )
    if not final_match_verified:
        target.unlink(missing_ok=True)
        shutil.rmtree(temporary, ignore_errors=True)
        raise RuntimeError(
            f"Полная аудиозапись не совпадает с мелодией .kar ({match['score']:.0%})"
        )
    shutil.rmtree(temporary, ignore_errors=True)
    return {
        "query": queries[0][1],
        "search_queries": [query for _intent, query in queries],
        "url": str(info.get("webpage_url") or webpage),
        "title": str(info.get("title") or selected.get("title") or ""),
        "uploader": str(info.get("uploader") or selected.get("uploader") or ""),
        "duration": float(info.get("duration") or selected.get("duration") or 0),
        "midi_audio_match": match,
        "preview_title": str(preview_info.get("title") or ""),
        "thumbnail_url": str(info.get("thumbnail") or selected.get("thumbnail") or ""),
    }


def _lyrics_payload(document: KarDocument, source_kind: str = "kar") -> dict[str, Any]:
    return validate_lyrics_document(
        {
            "schemaVersion": 1,
            "bpm": document.bpm,
            "duration": document.duration,
            "key": document.key,
            "reference_audio": "original.flac",
            "text": document.text.strip()
            or " ".join(word["text"] for word in document.words),
            "words": [
                {**word, "notes": [dict(note) for note in word["notes"]]} for word in document.words
            ],
            "source": source_kind,
        }
    )


def _prepare_fast_stems(target: Path) -> bool:
    """Atomically create raw vocal/backing stems for a training example."""
    original = target / "original.flac"
    if not original.is_file():
        return False
    processing = target / ".stems-processing"
    shutil.rmtree(processing, ignore_errors=True)
    processing.mkdir(parents=True)
    temporary_vocals = processing / "vocals.flac"
    temporary_instrumental = processing / "instrumental.flac"
    try:
        ai_bridge.separate_training_stems(
            original,
            temporary_vocals,
            temporary_instrumental,
        )
        if not all(
            path.is_file() and path.stat().st_size > 0
            for path in (temporary_vocals, temporary_instrumental)
        ):
            raise RuntimeError("Разделитель не создал обе аудиодорожки")
        os.replace(temporary_vocals, target / "vocals.flac")
        os.replace(temporary_instrumental, target / "instrumental.flac")
        return True
    finally:
        shutil.rmtree(processing, ignore_errors=True)


def _prepare_visual_assets(
    target: Path,
    title: str,
    artist: str | None,
    *,
    cover_url: str = "",
    expected_duration: float | None = None,
) -> dict[str, object]:
    """Prepare optional media without ever invalidating audio training data."""
    try:
        return metadata_enrichment_service.prepare_training_media(
            title,
            artist,
            target,
            cover_url=cover_url,
            expected_duration=expected_duration,
        )
    except Exception as exc:
        return {
            "cover_status": "fallback",
            "video_status": "fallback",
            "video_id": None,
            "warnings": [f"Не удалось подготовить визуальные файлы: {exc}"],
        }


def _unique_dataset_dir(root: Path, document: KarDocument) -> Path:
    """Reserve a unique folder atomically so parallel imports cannot collide."""
    fallback = song_service.slugify(document.title, "kar-song")
    base_name = song_service.song_folder_name(document.artist, document.title, fallback)
    suffix = 1
    while True:
        name = base_name if suffix == 1 else f"{base_name} ({suffix})"
        candidate = root / name
        try:
            candidate.mkdir(parents=False)
            return candidate
        except FileExistsError:
            suffix += 1


def _refine_vocal_alignment(
    source: Path,
    original_filename: str | None,
    source_kind: str,
    vocals_path: Path,
    audio_source: dict[str, Any],
    *,
    title_override: str | None = None,
    artist_override: str | None = None,
) -> tuple[KarDocument, dict[str, Any], dict[str, Any], dict[str, Any]] | None:
    raw_document = parse_kar(source, original_filename=original_filename)
    _apply_known_identity(raw_document, title=title_override, artist=artist_override)
    vocal_match = _midi_audio_match(
        raw_document,
        vocals_path,
        max_offset_seconds=_MAX_VOCAL_AUDIO_OFFSET_SECONDS,
    )
    vocal_bpm = float(vocal_match["audio_bpm"])
    # The accompaniment in the original mix can create a stronger but false
    # tempo/pitch match.  The isolated vocal must agree with the MIDI tempo,
    # not with that earlier mix estimate.
    bpm_ratio = vocal_bpm / max(float(raw_document.bpm), 0.001)
    if vocal_match["score"] < _MIN_MELODY_MATCH_SCORE or not 0.94 <= bpm_ratio <= 1.06:
        return None
    display_offset = float(vocal_match["offset_seconds"]) - _VOCAL_DISPLAY_LEAD_SECONDS
    first_word_start = min(
        (float(word.get("start") or 0) for word in raw_document.words),
        default=0.0,
    )
    scaled_first_word_start = first_word_start * raw_document.bpm / max(vocal_bpm, 0.001)
    # A repeated chorus can produce a deceptively strong chroma match several
    # seconds before the actual opening verse. Applying such an offset clamps
    # many different words to 0.0, so the UI starts on a later line and piles
    # all opening notes on top of each other. A refinement may move the opening
    # close to zero, but it must never move it before the audio timeline.
    if scaled_first_word_start + display_offset < 0:
        return None
    vocal_match = {
        **vocal_match,
        "offset_seconds": round(display_offset, 3),
        "display_lead_seconds": _VOCAL_DISPLAY_LEAD_SECONDS,
    }
    document = parse_kar(
        source,
        original_filename=original_filename,
        bpm_override=vocal_bpm,
        offset_seconds=float(vocal_match["offset_seconds"]),
    )
    _apply_known_identity(document, title=title_override, artist=artist_override)
    return (
        document,
        _lyrics_payload(document, source_kind),
        {**vocal_match, "status": "vocal-stem-refined"},
        {**audio_source, "midi_audio_match": vocal_match},
    )


def _prepare_dataset_stems(
    target: Path,
    warnings: list[str],
    progress: DatasetProgress | None,
    cancelled: CancelCallback | None,
) -> str | None:
    if not (target / "original.flac").is_file():
        return None
    try:
        _notify_dataset(progress, cancelled, "separate", 36, "Разделяем голос и минусовку")
        _prepare_fast_stems(target)
        _notify_dataset(progress, cancelled, "separate", 68, "Голос и минусовка готовы")
        return None
    except Exception as exc:
        warnings.append(f"Не удалось разделить оригинал на голос и минус: {exc}")
        (target / "vocals.flac").unlink(missing_ok=True)
        (target / "instrumental.flac").unlink(missing_ok=True)
        return str(exc)


def _parse_dataset_document(
    source: Path, original_filename: str | None, source_kind: str
) -> KarDocument:
    try:
        document = parse_kar(source, original_filename=original_filename)
    except ValueError as exc:
        if source_kind == "mid":
            raise MidiSkipped(f"MID пропущен: {exc}") from exc
        raise
    if source_kind == "mid":
        coverage = sum(bool(word.get("notes")) for word in document.words) / max(
            1, len(document.words)
        )
        if document.melody_track is None or coverage < 0.45:
            raise MidiSkipped("MID пропущен: нет надёжно синхронизированных текста и вокальных нот")
    return document


def prepare_kar_file(
    path: str | Path,
    *,
    original_filename: str | None = None,
    title_override: str | None = None,
    artist_override: str | None = None,
    output_root: str | Path = DATASET_DIR,
    download_audio: bool = True,
    target_dir: str | Path | None = None,
    progress: DatasetProgress | None = None,
    cancelled: CancelCallback | None = None,
) -> dict[str, Any]:
    source = Path(path)
    source_kind = "mid" if source.suffix.casefold() == ".mid" else "kar"
    _notify_dataset(progress, cancelled, "karaoke_parse", 2, "Читаем слова и ноты")
    document = _parse_dataset_document(source, original_filename, source_kind)
    _apply_known_identity(document, title=title_override, artist=artist_override)
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    root = Path(output_root)
    root.mkdir(parents=True, exist_ok=True)
    target = Path(target_dir) if target_dir is not None else _unique_dataset_dir(root, document)
    target.mkdir(parents=True, exist_ok=True)
    warnings: list[str] = []
    symbolic_source = target / f"source.{source_kind}"
    if source.resolve() != symbolic_source.resolve():
        shutil.copy2(source, symbolic_source)
    _notify_dataset(progress, cancelled, "karaoke_parse", 6, "Разметка караоке прочитана")
    reference = _lyrics_payload(document, source_kind)
    audio_source: dict[str, Any] | None = None
    comparison: dict[str, Any] = {
        "status": f"{source_kind}-reference",
        "time_scale": 1.0,
        "offset_seconds": 0.0,
        "pitch_shift_semitones": 0,
    }
    try:
        if download_audio:
            _notify_dataset(progress, cancelled, "karaoke_audio", 8, "Ищем оригинальную песню")
            audio_source = _download_audio(document, target)
            match = audio_source["midi_audio_match"]
            document = parse_kar(
                source,
                original_filename=original_filename,
                bpm_override=float(match["audio_bpm"]),
                offset_seconds=float(match["offset_seconds"]),
            )
            _apply_known_identity(document, title=title_override, artist=artist_override)
            reference = _lyrics_payload(document, source_kind)
            comparison = {
                **match,
                "status": "audio-bpm-applied",
            }
            _notify_dataset(progress, cancelled, "karaoke_audio", 34, "Оригинальная песня получена")
    except Exception as exc:
        warnings.append(str(exc))
        (target / "original.flac").unlink(missing_ok=True)
        shutil.rmtree(target / ".download", ignore_errors=True)
        shutil.rmtree(target / ".processing", ignore_errors=True)
        (target / "kar-lyrics.txt").unlink(missing_ok=True)
    stems_error = _prepare_dataset_stems(target, warnings, progress, cancelled)
    vocals_path = target / "vocals.flac"
    if audio_source is not None and vocals_path.is_file():
        try:
            refined = _refine_vocal_alignment(
                source,
                original_filename,
                source_kind,
                vocals_path,
                audio_source,
                title_override=title_override,
                artist_override=artist_override,
            )
            if refined is not None:
                document, reference, comparison, audio_source = refined
        except Exception as exc:
            warnings.append(f"Не удалось уточнить синхронизацию по голосу: {exc}")
    media: dict[str, object] = {
        "cover_status": "fallback",
        "video_status": "fallback",
        "video_id": None,
        "warnings": [],
    }
    if (target / "original.flac").is_file():
        _notify_dataset(progress, cancelled, "karaoke_media", 70, "Подготавливаем обложку и клип")
        media_artist, media_title = _audio_search_identity(document)
        media = _prepare_visual_assets(
            target,
            media_title,
            media_artist,
            cover_url=str((audio_source or {}).get("thumbnail_url") or ""),
            expected_duration=float((audio_source or {}).get("duration") or 0) or None,
        )
        warnings.extend(map(str, media_warnings if isinstance((media_warnings := media.get("warnings", [])), list) else []))
        _notify_dataset(progress, cancelled, "karaoke_media", 97, "Визуальные файлы готовы")
    write_json(target / "lyricsSync.json", reference)
    write_json(target / "comparison.json", comparison)
    note_count = sum(len(word.get("notes", [])) for word in reference["words"])
    original_ready = (target / "original.flac").is_file()
    stems_ready = all((target / name).is_file() for name in ("vocals.flac", "instrumental.flac"))
    metadata = {
        "dataset_version": 2,
        "status": "ready" if original_ready else "review",
        "preparation_mode": (
            f"{source_kind}-with-original-audio-bpm" if audio_source else f"{source_kind}-reference"
        ),
        "stems_status": "ready" if stems_ready else "error" if stems_error else "deferred",
        "title": document.title,
        "artist": document.artist,
        "bpm": reference["bpm"],
        "key": document.key,
        "duration": reference.get("duration", document.duration),
        "word_count": len(reference["words"]),
        "note_count": note_count,
        f"{source_kind}_sha256": digest,
        "original_filename": original_filename or source.name,
        "lyric_track": document.lyric_track,
        "melody_track": document.melody_track,
        "audio_source": audio_source,
        "media": {key: value for key, value in media.items() if key != "warnings"},
        "alignment": comparison,
        "warnings": warnings,
        "files": sorted(path.name for path in target.iterdir() if path.is_file()),
    }
    write_json(target / "metadata.json", metadata)
    if metadata["status"] == "ready" and metadata["stems_status"] == "ready":
        _notify_dataset(progress, cancelled, "complete", 100, "Песня готова к караоке")
    return {**metadata, "dataset_dir": str(target.resolve())}
