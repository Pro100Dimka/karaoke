"""
Шаг 8. Анализ текста.
song.mp3 / vocals.wav -> lyrics.txt

Источники (по приоритету):
1. Встроенные ID3-теги (USLT / lyrics) через mutagen.
2. Файл .lrc рядом с треком.
3. Распознавание речи через Whisper (если ничего не найдено).
4. Текст, введённый вручную.
"""
import argparse
import re
from pathlib import Path

from mutagen import File as MutagenFile
from mutagen.id3 import USLT
from src.common.model_paths import whisper_dir


def from_id3_tags(audio_path: str) -> str | None:
    try:
        audio = MutagenFile(audio_path)
        if audio is None:
            return None
        # MP3 / ID3
        if hasattr(audio, "tags") and audio.tags:
            for tag in audio.tags.values():
                if isinstance(tag, USLT):
                    return tag.text
        # Другие форматы (FLAC/OGG и т.п.) хранят lyrics как обычный ключ
        if hasattr(audio, "get"):
            for key in ("LYRICS", "lyrics", "\xa9lyr"):
                val = audio.get(key)
                if val:
                    return "\n".join(val) if isinstance(val, list) else str(val)
    except Exception:
        return None
    return None


def from_lrc_file(audio_path: str) -> str | None:
    lrc_path = Path(audio_path).with_suffix(".lrc")
    if lrc_path.exists():
        raw = lrc_path.read_text(encoding="utf-8")
        # убираем временные метки [mm:ss.xx]
        lines = [re.sub(r"\[\d{2}:\d{2}(\.\d{2,3})?\]", "", line).strip()
                 for line in raw.splitlines()]
        return "\n".join(line for line in lines if line)
    return None


def from_whisper(audio_path: str, model_size: str = "medium", language: str | None = None) -> str:
    import whisper  # openai-whisper
    model = whisper.load_model(model_size, download_root=str(whisper_dir()))
    result = model.transcribe(audio_path, language=language)
    return result["text"].strip()


def get_lyrics(audio_path: str, whisper_model: str = "medium",
                language: str | None = None,
                whisper_audio_path: str | None = None,
                transcribe_if_missing: bool = True) -> tuple[str, str]:
    """
    Возвращает (текст, источник).

    audio_path          — оригинальный файл (mp3), где ищем ID3-теги/.lrc
    whisper_audio_path   — файл для распознавания речи, если теги/lrc не
                           найдены. ВАЖНО: должен быть ИЗОЛИРОВАННЫЙ вокал
                           (vocals.wav после Demucs), а не полный микс —
                           иначе Whisper путает слова с инструменталом.
                           Если не передан, используется audio_path.
    """
    text = from_id3_tags(audio_path)
    if text:
        return text, "id3_tags"

    text = from_lrc_file(audio_path)
    if text:
        return text, "lrc_file"

    if not transcribe_if_missing:
        return "", "deferred_to_timed_transcription"

    text = from_whisper(whisper_audio_path or audio_path, whisper_model, language)
    return text, "whisper"


def main():
    parser = argparse.ArgumentParser(description="Получение текста песни")
    parser.add_argument("input", help="song.mp3 (для проверки ID3-тегов/.lrc)")
    parser.add_argument("output", nargs="?", default="lyrics.txt")
    parser.add_argument("--whisper-audio", default=None,
                         help="vocals.wav — использовать для Whisper-фолбэка вместо "
                              "полного микса, если теги/lrc не найдены (рекомендуется)")
    parser.add_argument("--whisper-model", default="medium",
                         choices=["tiny", "base", "small", "medium", "large"])
    parser.add_argument("--language", default=None, help="код языка, напр. ru, en")
    args = parser.parse_args()

    text, source = get_lyrics(args.input, args.whisper_model, args.language,
                               whisper_audio_path=args.whisper_audio)

    Path(args.output).write_text(text, encoding="utf-8")
    print(f"Источник текста: {source}")
    print(f"Сохранено: {args.output}")


if __name__ == "__main__":
    main()
