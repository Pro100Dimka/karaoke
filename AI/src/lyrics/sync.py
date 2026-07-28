"""
Шаг 9. Синхронизация текста.
vocals.wav + lyrics.txt -> lyricsSync.json

Для каждой строки (и, по возможности, каждого слова) определяет
время начала и конца. Использует Whisper с word-level timestamps —
это одновременно распознаёт и выравнивает текст по аудио.
"""
import argparse
import json
from pathlib import Path


def sync_with_whisper(audio_path: str, model_size: str = "medium",
                       language: str | None = None) -> list:
    import whisper

    model = whisper.load_model(model_size)
    result = model.transcribe(audio_path, language=language, word_timestamps=True)

    lines = []
    for segment in result["segments"]:
        words = [
            {
                "word": w["word"].strip(),
                "start": round(w["start"], 3),
                "end": round(w["end"], 3),
            }
            for w in segment.get("words", [])
        ]
        lines.append({
            "text": segment["text"].strip(),
            "start": round(segment["start"], 3),
            "end": round(segment["end"], 3),
            "words": words,
        })
    return lines


def sync_existing_lyrics_with_whisper(audio_path: str, lyrics_path: str,
                                       model_size: str = "medium",
                                       language: str | None = None) -> list:
    """
    Если текст уже есть (из тегов/LRC) и нужно только выровнять его
    по времени, самый практичный вариант без сторонних форс-алайнеров —
    всё равно прогнать Whisper по аудио (он даёт свои тайминги очень точно)
    и, если есть готовый текст, использовать его только для сверки/замены
    орфографии построчно (эвристически по порядку строк).
    """
    whisper_lines = sync_with_whisper(audio_path, model_size, language)

    given_text = Path(lyrics_path).read_text(encoding="utf-8")
    given_lines = [l.strip() for l in given_text.splitlines() if l.strip()]

    # Если количество строк совпадает — подставляем "эталонный" текст,
    # оставляя тайминги Whisper
    if len(given_lines) == len(whisper_lines):
        for wl, gl in zip(whisper_lines, given_lines):
            wl["text"] = gl

    return whisper_lines


def main():
    parser = argparse.ArgumentParser(description="Синхронизация текста песни с аудио")
    parser.add_argument("audio", help="vocals.wav")
    parser.add_argument("--lyrics", default=None,
                         help="lyrics.txt (если есть готовый текст для сверки)")
    parser.add_argument("output", nargs="?", default="lyricsSync.json")
    parser.add_argument("--whisper-model", default="medium")
    parser.add_argument("--language", default=None)
    args = parser.parse_args()

    if args.lyrics:
        lines = sync_existing_lyrics_with_whisper(
            args.audio, args.lyrics, args.whisper_model, args.language)
    else:
        lines = sync_with_whisper(args.audio, args.whisper_model, args.language)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(lines, f, ensure_ascii=False, indent=2)

    print(f"Синхронизировано {len(lines)} строк -> {args.output}")


if __name__ == "__main__":
    main()
