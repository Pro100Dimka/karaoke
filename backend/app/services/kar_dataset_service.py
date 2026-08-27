"""Prepare supervised karaoke-training examples from MIDI karaoke files."""

from __future__ import annotations

import hashlib
import math
import re
import shutil
import subprocess
from bisect import bisect_right
from dataclasses import dataclass
from difflib import SequenceMatcher
from pathlib import Path
from typing import Any

import mido
import numpy as np

import config
from AI.lyrics_document import validate_lyrics_document
from app.services import song_service
from app.utils.json_files import write_json

try:
    from yt_dlp import YoutubeDL
except ImportError:  # pragma: no cover - lightweight API-only installations
    YoutubeDL = None


DATASET_DIR = config.DATA_DIR / "kar-training-dataset"
MAX_KAR_BYTES = 8 * 1024 * 1024
SUPPORTED_KARAOKE_MIDI_SUFFIXES = {".kar", ".mid"}


class MidiSkipped(ValueError):
    """A valid MIDI file that does not contain reliable karaoke markup."""


_REJECTED_AUDIO_HINTS = (
    "karaoke",
    "lyrics",
    "lyric video",
    "instrumental",
    "cover version",
    "cover by",
    "tribute",
    "reaction",
    "remix",
    "slowed",
    "nightcore",
    "8d audio",
    "караоке",
    "текст песни",
    "кавер",
    "demo",
    "live",
    "concert",
    "minecraft",
    "демо",
    "концерт",
    "майнкрафт",
)
_MAX_AUDIO_DURATION_DRIFT_SECONDS = 20.0
_MAX_AUDIO_DURATION_DRIFT_RATIO = 0.12
_MIN_MELODY_MATCH_SCORE = 0.45
# A MIDI melody is periodic enough that an unrestricted chroma search can
# confidently lock to the same chord one or two bars away.  That moved the
# lyrics several seconds ahead of the vocal in otherwise matching masters.
# Original KAR/MID files normally need only a small lead-in correction; larger
# differences are exposed to the user as a manual offset instead of silently
# corrupting the reference labels.
_MAX_AUTOMATIC_AUDIO_OFFSET_SECONDS = 1.0
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
            tick += int(message.time)
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
    titles, key = [], "Unknown"
    for track in tracks:
        for _tick, message in track:
            if message.type == "key_signature" and key == "Unknown":
                key = str(message.key)
            if message.type not in {"text", "lyrics"}:
                continue
            text = str(getattr(message, "text", "")).strip()
            if text.upper().startswith("@T"):
                value = _clean_text(text[2:])
                if value:
                    titles.append(value)
    title = titles[0] if titles else ""
    artist = titles[1] if len(titles) > 1 else ""
    # A widespread .kar convention stores "title - artist" in the first @T
    # line and uses subsequent @T lines for composers, translators or the
    # authoring program. Treating the second line as the performer produces
    # incorrect folders such as "Golden Earring Пушкина М. Беспечный ангел".
    composite = re.match(r"^(.+?)\s+[-–—]\s+(.+)$", title)
    if composite:
        title, artist = (_clean_text(composite.group(1)), _clean_text(composite.group(2)))
    return title, artist, key


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

    def flush() -> None:
        nonlocal current_text, current_start, current_end
        text = current_text.strip()
        if text:
            end = max(current_start + 0.04, current_end)
            words.append(
                {
                    "text": text,
                    "start": round(current_start, 3),
                    "end": round(end, 3),
                    "notes": [],
                }
            )
            line_words.append(text)
        current_text = ""

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
            if raw.endswith((" ", "\t")):
                flush()
    finish_line()
    if not words:
        raise ValueError("В .kar найден текст, но не удалось выделить слова")
    for index, word in enumerate(words[:-1]):
        word["end"] = round(
            max(word["start"] + 0.04, min(word["end"], words[index + 1]["start"])),
            3,
        )
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
        hint = 10_000 if re.search(r"vocal|voice|melody|lead|sing|вокал|мелод", name, re.I) else 0
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
        ranked.append(
            (
                hint
                + same_track
                + range_bonus
                + min(len(relevant), 120)
                + overlap
                + onset_ratio * 20_000,
                track_index,
                relevant,
            )
        )
    if not ranked:
        return None, []
    _score, track_index, notes = max(ranked, key=lambda item: item[0])
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
        words[owner]["notes"].append(
            {
                "note": int(note["note"]),
                "start": round(float(note["start"]), 3),
                "end": round(float(note["end"]), 3),
            }
        )
        count += 1
    return count


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
            chosen = min(
                group,
                key=lambda item: (
                    abs(int(item["note"]) - previous_pitch),
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
    if suffix == ".mid":
        notes = _monophonize_notes(notes)
    if notes:
        last = words[-1]
        sustained = [
            note["end"] for note in notes if last["start"] <= note["start"] <= last["end"] + 0.5
        ]
        if sustained:
            last["end"] = round(max(last["end"], max(sustained)), 3)
    _attach_notes(words, notes)
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
    prefix, separator, suffix = document.title.partition(":")
    cleaned_suffix = suffix.strip().strip("\"'«»“”„ ")
    if separator and prefix.strip() and cleaned_suffix:
        return prefix.strip(), cleaned_suffix
    return document.artist.strip(), document.title.strip()


def _duration_matches(document: KarDocument, duration: float) -> bool:
    if not duration or not document.duration:
        return True
    maximum_drift = max(
        _MAX_AUDIO_DURATION_DRIFT_SECONDS,
        document.duration * _MAX_AUDIO_DURATION_DRIFT_RATIO,
    )
    return abs(duration - document.duration) <= maximum_drift


def _audio_candidate_score(entry: dict[str, Any], document: KarDocument) -> float | None:
    title = str(entry.get("title") or "")
    normalized = title.casefold()
    if any(hint in normalized for hint in _REJECTED_AUDIO_HINTS):
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
    if artist_words and not artist_overlap:
        return None
    duration = float(entry.get("duration") or 0)
    duration_penalty = abs(duration - document.duration) if duration and document.duration else 0
    if not _duration_matches(document, duration):
        return None
    uploader_overlap = _overlap_count(artist_words, uploader_words)
    official = 8 if any(hint in normalized for hint in ("official", "audio", "music video")) else 0
    return (
        title_overlap * 20
        + artist_overlap * 12
        + uploader_overlap * 14
        + official
        - duration_penalty / 3
    )


def _candidate_url(entry: dict[str, Any]) -> str | None:
    value = entry.get("webpage_url") or entry.get("url") or entry.get("id")
    if not value:
        return None
    value = str(value)
    return (
        f"https://www.youtube.com/watch?v={value}" if re.fullmatch(r"[\w-]{11}", value) else value
    )


def _midi_audio_match(document: KarDocument, audio_path: Path) -> dict[str, Any]:
    import librosa

    audio, rate = librosa.load(audio_path, sr=11_025, mono=True)
    if audio.size < rate * 20:
        raise RuntimeError("Найденная аудиозапись слишком короткая")
    hop = 1024
    chroma = librosa.feature.chroma_cqt(y=audio, sr=rate, hop_length=hop)
    chroma /= np.maximum(chroma.max(axis=0, keepdims=True), 1e-6)
    top_three_mask = np.zeros_like(chroma, dtype=bool)
    top_three = np.argsort(chroma, axis=0)[-3:]
    top_three_mask[top_three, np.arange(chroma.shape[1])] = True
    notes = [
        note
        for word in document.words
        for note in word.get("notes", [])
        if float(note["end"]) - float(note["start"]) >= 0.08
    ]
    if len(notes) < 24:
        raise RuntimeError("В .kar недостаточно нот для проверки найденной аудиозаписи")
    step = max(1, len(notes) // 600)
    sampled = notes[::step]
    midpoints = np.asarray(
        [(float(note["start"]) + float(note["end"])) / 2 for note in sampled],
        dtype=np.float64,
    )
    pitch_classes = np.asarray([int(note["note"]) % 12 for note in sampled], dtype=np.int16)
    audio_duration = float(audio.size / rate)
    detected_bpm = float(np.asarray(librosa.feature.tempo(y=audio, sr=rate)).reshape(-1)[0])
    detected_near_kar = _closest_tempo_octave(detected_bpm, document.bpm)

    # ``librosa.feature.tempo`` is intentionally only a hint.  On real rock
    # recordings it reported 143.555 for a ~148.7 BPM master; blindly applying
    # that value accumulated seconds of drift.  Search tempo and lead-in
    # jointly against the MIDI melody, then refine around the coarse optimum.
    # The vectorized scorer keeps this cheaper than the previous nested
    # per-note implementation even though it now determines the actual tempo.
    best_score, best_rank, best_bpm, best_offset, best_count, best_shift = (
        0.0,
        -math.inf,
        detected_near_kar,
        0.0,
        0,
        0,
    )

    def search(bpms: np.ndarray, offsets: np.ndarray) -> None:
        nonlocal best_score, best_rank, best_bpm, best_offset, best_count, best_shift
        for bpm in bpms:
            time_scale = document.bpm / max(float(bpm), 0.001)
            scaled_midpoints = midpoints * time_scale
            for offset in offsets:
                frames = ((scaled_midpoints + float(offset)) * rate / hop).astype(np.int64)
                valid = (frames >= 0) & (frames < chroma.shape[1])
                count = int(np.count_nonzero(valid))
                if count < 24:
                    continue
                valid_frames = frames[valid]
                valid_pitches = pitch_classes[valid]
                for pitch_shift in range(-6, 6):
                    shifted = (valid_pitches + pitch_shift) % 12
                    score = 0.65 * float(np.mean(chroma[shifted, valid_frames])) + 0.35 * float(
                        np.mean(top_three_mask[shifted, valid_frames])
                    )
                    # Stable tie-breaking: prefer the tempo detector's octave
                    # and the smallest lead-in correction when chroma scores
                    # are indistinguishable (e.g. synthetic/constant spectra).
                    rank = score - 1e-7 * abs(float(bpm) - detected_near_kar) - 1e-7 * abs(
                        float(offset)
                    )
                    if rank > best_rank:
                        best_score, best_rank = score, rank
                        best_bpm, best_offset = float(bpm), float(offset)
                        best_count, best_shift = count, pitch_shift

    coarse_bpms = np.arange(document.bpm * 0.88, document.bpm * 1.12 + 0.001, 0.5)
    coarse_offsets = np.arange(
        -_MAX_AUTOMATIC_AUDIO_OFFSET_SECONDS,
        _MAX_AUTOMATIC_AUDIO_OFFSET_SECONDS + 0.001,
        0.25,
    )
    search(coarse_bpms, coarse_offsets)

    coarse_bpm, coarse_offset = best_bpm, best_offset
    fine_bpms = np.arange(coarse_bpm - 0.5, coarse_bpm + 0.501, 0.05)
    fine_offsets = np.arange(
        max(-_MAX_AUTOMATIC_AUDIO_OFFSET_SECONDS, coarse_offset - 0.25),
        min(_MAX_AUTOMATIC_AUDIO_OFFSET_SECONDS, coarse_offset + 0.25) + 0.001,
        0.05,
    )
    search(fine_bpms, fine_offsets)
    audio_bpm = best_bpm
    time_scale = document.bpm / max(audio_bpm, 0.001)
    return {
        "score": round(best_score, 4),
        "offset_seconds": round(best_offset, 3),
        "time_scale": round(time_scale, 6),
        "kar_bpm": round(document.bpm, 3),
        "audio_bpm": round(audio_bpm, 3),
        "detected_audio_bpm": round(detected_bpm, 3),
        "pitch_shift_semitones": best_shift,
        "audio_duration": round(audio_duration, 3),
        "compared_notes": best_count,
    }


def _closest_tempo_octave(detected_bpm: float, kar_bpm: float) -> float:
    """Resolve the common half/double-tempo ambiguity against the KAR tempo."""
    if not math.isfinite(detected_bpm) or detected_bpm <= 0:
        raise RuntimeError("Не удалось определить BPM оригинальной песни")
    if not math.isfinite(kar_bpm) or kar_bpm <= 0:
        return detected_bpm
    candidates = [
        detected_bpm * (2**octave)
        for octave in range(-3, 4)
        if 35 <= detected_bpm * (2**octave) <= 260
    ]
    return min(candidates, key=lambda value: abs(math.log(value / kar_bpm)))


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
    query = " ".join(filter(None, (expected_artist, expected_title, "official audio")))
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
        result = downloader.extract_info(f"ytsearch8:{query}", download=False)
    entries = result.get("entries", []) if isinstance(result, dict) else []
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
            match = _midi_audio_match(document, preview)
            matches.append((_metadata_score, entry, preview_info, match))
        except Exception:
            continue
        finally:
            (temporary / f"preview-{index}.wav").unlink(missing_ok=True)
    if not matches:
        shutil.rmtree(temporary, ignore_errors=True)
        raise RuntimeError("Не удалось проверить найденные аудиозаписи по мелодии .kar")
    verified_matches = [item for item in matches if item[3]["score"] >= _MIN_MELODY_MATCH_SCORE]
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
    _metadata_score, selected, preview_info, match = max(
        verified_matches,
        key=lambda item: (item[0], item[3]["score"]),
    )
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
        "title": info.get("title") or selected.get("title"),
        "uploader": info.get("uploader") or selected.get("uploader"),
        "duration": info.get("duration") or selected.get("duration"),
    }
    if _audio_candidate_score(final_entry, document) is None:
        target.unlink(missing_ok=True)
        shutil.rmtree(temporary, ignore_errors=True)
        raise RuntimeError(
            "Скачанная запись не совпадает с исполнителем, названием или длительностью .kar"
        )
    if match["score"] < _MIN_MELODY_MATCH_SCORE:
        target.unlink(missing_ok=True)
        shutil.rmtree(temporary, ignore_errors=True)
        raise RuntimeError(
            f"Полная аудиозапись не совпадает с мелодией .kar ({match['score']:.0%})"
        )
    shutil.rmtree(temporary, ignore_errors=True)
    return {
        "query": query,
        "url": str(info.get("webpage_url") or webpage),
        "title": str(info.get("title") or selected.get("title") or ""),
        "uploader": str(info.get("uploader") or selected.get("uploader") or ""),
        "duration": float(info.get("duration") or selected.get("duration") or 0),
        "midi_audio_match": match,
        "preview_title": str(preview_info.get("title") or ""),
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


def prepare_kar_file(
    path: str | Path,
    *,
    original_filename: str | None = None,
    output_root: str | Path = DATASET_DIR,
    download_audio: bool = True,
) -> dict[str, Any]:
    source = Path(path)
    source_kind = "mid" if source.suffix.casefold() == ".mid" else "kar"
    try:
        document = parse_kar(source, original_filename=original_filename)
    except ValueError as exc:
        if source_kind == "mid":
            raise MidiSkipped(f"MID пропущен: {exc}") from exc
        raise
    if source_kind == "mid":
        words_with_notes = sum(bool(word.get("notes")) for word in document.words)
        coverage = words_with_notes / max(1, len(document.words))
        if document.melody_track is None or coverage < 0.45:
            raise MidiSkipped("MID пропущен: нет надёжно синхронизированных текста и вокальных нот")
    digest = hashlib.sha256(source.read_bytes()).hexdigest()
    root = Path(output_root)
    root.mkdir(parents=True, exist_ok=True)
    target = _unique_dataset_dir(root, document)
    warnings: list[str] = []
    shutil.copy2(source, target / f"source.{source_kind}")
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
            audio_source = _download_audio(document, target)
            match = audio_source["midi_audio_match"]
            document = parse_kar(
                source,
                original_filename=original_filename,
                bpm_override=float(match["audio_bpm"]),
                offset_seconds=float(match["offset_seconds"]),
            )
            reference = _lyrics_payload(document, source_kind)
            comparison = {
                **match,
                "status": "audio-bpm-applied",
            }
    except Exception as exc:
        warnings.append(str(exc))
        (target / "original.flac").unlink(missing_ok=True)
        shutil.rmtree(target / ".download", ignore_errors=True)
        shutil.rmtree(target / ".processing", ignore_errors=True)
        (target / "kar-lyrics.txt").unlink(missing_ok=True)
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
        "stems_status": "ready" if stems_ready else "deferred",
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
        "alignment": comparison,
        "warnings": warnings,
        "files": sorted(path.name for path in target.iterdir() if path.is_file()),
    }
    write_json(target / "metadata.json", metadata)
    return {**metadata, "dataset_dir": str(target.resolve())}
