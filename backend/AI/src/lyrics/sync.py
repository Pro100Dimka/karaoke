"""Synchronize lyric lines and words with isolated vocal audio."""

from __future__ import annotations

import argparse
import os
import threading
from functools import lru_cache
from pathlib import Path
from typing import Any

from src.common.json_io import save_json
from src.common.model_paths import whisper_dir
from src.lyrics.alignment import project_lyrics_onto_timing, reconcile_lyric_words



_TRANSCRIBE_LOCK = threading.Lock()
_MODEL_LOAD_LOCK = threading.Lock()


@lru_cache(maxsize=1)
def _faster_whisper_model(model_name: str, device: str, compute_type: str):
    """Keep one heavy model alive across sequential frontend jobs."""
    from faster_whisper import WhisperModel

    with _MODEL_LOAD_LOCK:
        return WhisperModel(
            model_name,
            device=device,
            compute_type=compute_type,
            download_root=str(whisper_dir() / "faster-whisper"),
            cpu_threads=max(1, min(8, os.cpu_count() or 4)),
            num_workers=1,
        )




@lru_cache(maxsize=1)
def _openai_whisper_model(model_size: str):
    import whisper

    return whisper.load_model(model_size, download_root=str(whisper_dir()))


def _faster_whisper_runtime() -> tuple[str, str]:
    requested_device = os.getenv("SONGAPP_DEVICE", "auto").strip().lower()
    if requested_device == "cpu":
        return "cpu", "int8"
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", "float16"
    except (ImportError, OSError, RuntimeError):
        pass
    return "cpu", "int8"


def _segment_dict(segment: Any, words: list[dict[str, Any]]) -> dict[str, Any] | None:
    text = str(getattr(segment, "text", "") if not isinstance(segment, dict) else segment.get("text", "")).strip()
    if not text:
        return None
    start = getattr(segment, "start", 0.0) if not isinstance(segment, dict) else segment.get("start", 0.0)
    end = getattr(segment, "end", 0.0) if not isinstance(segment, dict) else segment.get("end", 0.0)
    return {
        "text": text,
        "start": round(float(start), 3),
        "end": round(float(end), 3),
        "words": words,
    }


def _word_dict(word: Any, fallback_start: float = 0.0, fallback_end: float = 0.0) -> dict[str, Any] | None:
    if isinstance(word, dict):
        text = str(word.get("word", "")).strip()
        start, end = word.get("start", fallback_start), word.get("end", fallback_end)
    else:
        text = str(getattr(word, "word", "")).strip()
        start, end = getattr(word, "start", None), getattr(word, "end", None)
        if start is None or end is None:
            return None
    if not text:
        return None
    return {"word": text, "start": round(float(start), 3), "end": round(float(end), 3)}


def _transcribe_faster(audio_path: str, language: str | None, device: str, compute_type: str, initial_prompt: str | None = None) -> list:
    model_name = os.getenv("SONGAPP_FASTER_WHISPER_MODEL", "large-v3-turbo")
    model = _faster_whisper_model(model_name, device, compute_type)
    # Singing contains long vowels and quiet consonants. A softer VAD keeps them
    # while still skipping large instrumental pauses.
    vad_enabled = os.getenv("SONGAPP_WHISPER_VAD", "1").lower() not in {"0", "false", "no"}
    kwargs = dict(
        language=language,
        beam_size=max(1, int(os.getenv("SONGAPP_WHISPER_BEAM_SIZE", "2"))),
        word_timestamps=True,
        vad_filter=vad_enabled,
        condition_on_previous_text=False,
        initial_prompt=initial_prompt,
        temperature=0.0,
        compression_ratio_threshold=2.6,
        log_prob_threshold=-1.2,
        no_speech_threshold=0.55,
    )
    if vad_enabled:
        kwargs["vad_parameters"] = {
            "threshold": 0.25,
            "min_speech_duration_ms": 100,
            "min_silence_duration_ms": 450,
            "speech_pad_ms": 250,
        }
    with _TRANSCRIBE_LOCK:
        segments, _ = model.transcribe(audio_path, **kwargs)
        segments = list(segments)
    lines = []
    for segment in segments:
        words = [item for word in (segment.words or []) if (item := _word_dict(word))]
        if line := _segment_dict(segment, words):
            lines.append(line)
    return reconcile_lyric_words(lines)


def sync_with_faster_whisper(audio_path: str, language: str | None = None, initial_prompt: str | None = None) -> list:
    device, compute_type = _faster_whisper_runtime()
    try:
        if initial_prompt is None:
            return _transcribe_faster(audio_path, language, device, compute_type)
        return _transcribe_faster(audio_path, language, device, compute_type, initial_prompt)
    except (OSError, RuntimeError, ValueError):
        if device != "cuda":
            raise
        if initial_prompt is None:
            return _transcribe_faster(audio_path, language, "cpu", "int8")
        return _transcribe_faster(audio_path, language, "cpu", "int8", initial_prompt)


def sync_with_whisper(audio_path: str, model_size: str = "medium", language: str | None = None, initial_prompt: str | None = None) -> list:
    model = _openai_whisper_model(model_size)
    result = model.transcribe(
        audio_path,
        language=language,
        word_timestamps=True,
        initial_prompt=initial_prompt,
        temperature=0.0,
        condition_on_previous_text=False,
    )
    lines = []
    for segment in result.get("segments", []):
        words = [
            item
            for word in segment.get("words", [])
            if (item := _word_dict(word, segment.get("start", 0.0), segment.get("end", 0.0)))
        ]
        if line := _segment_dict(segment, words):
            lines.append(line)
    return reconcile_lyric_words(lines)


def sync_with_whisperx(
    audio_path: str,
    model_size: str = "medium",
    language: str | None = None,
    device: str = "cpu",
) -> list:
    import whisperx

    compute_type = "float16" if device == "cuda" else "float32"
    model = whisperx.load_model(model_size, device, compute_type=compute_type, language=language)
    audio = whisperx.load_audio(audio_path)
    result = model.transcribe(audio, language=language)
    align_model, metadata = whisperx.load_align_model(language_code=result["language"], device=device)
    aligned = whisperx.align(
        result["segments"], align_model, metadata, audio, device, return_char_alignments=False
    )
    lines = []
    for segment in aligned.get("segments", []):
        words = [
            item
            for word in segment.get("words", [])
            if (item := _word_dict(word, segment.get("start", 0.0), segment.get("end", 0.0)))
        ]
        if line := _segment_dict(segment, words):
            lines.append(line)
    return reconcile_lyric_words(lines)


def _sync_raw(
    audio_path: str,
    model_size: str,
    language: str | None,
    engine: str,
    initial_prompt: str | None = None,
) -> list:
    if engine in {"auto", "faster-whisper"}:
        try:
            lines = sync_with_faster_whisper(audio_path, language, initial_prompt)
            if lines:
                return lines
            raise RuntimeError("faster-whisper returned no speech segments")
        except (ImportError, OSError, RuntimeError, ValueError) as exc:
            print(f"faster-whisper failed; falling back to Whisper. {exc}")
    if engine == "whisperx":
        try:
            return sync_with_whisperx(audio_path, model_size, language)
        except ImportError:
            print("whisperx не установлен — откатываюсь на whisper. Установить: pip install whisperx")
        except (OSError, RuntimeError, ValueError) as exc:
            print(f"whisperx завершился с ошибкой ({exc}) — откатываюсь на whisper.")
    return sync_with_whisper(audio_path, model_size, language, initial_prompt)


def sync_existing_lyrics_with_whisper(
    audio_path: str,
    lyrics_path: str,
    model_size: str = "medium",
    language: str | None = None,
    engine: str = "auto",
) -> list:
    given_lines = [
        line.strip()
        for line in Path(lyrics_path).read_text(encoding="utf-8").splitlines()
        if line.strip()
    ]
    # A complete song as prompt can force repeated hallucinations. Keep a
    # compact, order-preserving vocabulary hint instead.
    vocabulary: list[str] = []
    seen: set[str] = set()
    prompt_length = 0
    for token in " ".join(given_lines).split():
        key = token.casefold().strip(".,!?;:\"'()[]{}—-")
        if key and key not in seen:
            addition = len(token) + (1 if vocabulary else 0)
            if prompt_length + addition > 900:
                break
            seen.add(key)
            vocabulary.append(token)
            prompt_length += addition
    prompt = " ".join(vocabulary) or None
    lines = _sync_raw(audio_path, model_size, language, engine, prompt)
    return project_lyrics_onto_timing(given_lines, lines) if given_lines else lines


def main() -> None:
    parser = argparse.ArgumentParser(description="Синхронизация текста песни с аудио")
    parser.add_argument("audio", help="vocals.wav")
    parser.add_argument("--lyrics", default=None)
    parser.add_argument("output", nargs="?", default="lyricsSync.json")
    parser.add_argument("--whisper-model", default="medium")
    parser.add_argument("--language", default=None)
    parser.add_argument(
        "--engine",
        default="auto",
        choices=["auto", "faster-whisper", "whisper", "whisperx"],
    )
    args = parser.parse_args()
    lines = (
        sync_existing_lyrics_with_whisper(
            args.audio, args.lyrics, args.whisper_model, args.language, args.engine
        )
        if args.lyrics
        else _sync_raw(args.audio, args.whisper_model, args.language, args.engine)
    )
    save_json(lines, args.output)
    print(f"Синхронизировано {len(lines)} строк -> {args.output} (движок: {args.engine})")


if __name__ == "__main__":
    main()
