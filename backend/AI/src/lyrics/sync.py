"""
Шаг 9. Синхронизация текста.
vocals.wav + lyrics.txt -> lyricsSync.json

Для каждой строки (и, по возможности, каждого слова) определяет
время начала и конца.

Два движка:
- whisper (по умолчанию) — word-level timestamps встроены в сам Whisper,
  но они получены интерполяцией attention-весов и не всегда точны
  на границах слов.
- whisperx (--engine whisperx) — Whisper для распознавания + отдельная
  forced-alignment модель (wav2vec2) для точной привязки каждого слова
  к аудио. Заметно точнее на длинных треках, где обычный Whisper может
  "дрейфовать". Установка: pip install whisperx (бесплатно, open-source,
  требует ffmpeg и, как и обычный Whisper, PyTorch).
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


def sync_with_whisperx(audio_path: str, model_size: str = "medium",
                        language: str | None = None, device: str = "cpu") -> list:
    """WhisperX: распознавание + отдельный forced-alignment проход."""
    import whisperx

    compute_type = "float16" if device == "cuda" else "float32"
    model = whisperx.load_model(model_size, device, compute_type=compute_type,
                                 language=language)
    audio = whisperx.load_audio(audio_path)
    result = model.transcribe(audio, language=language)

    align_model, metadata = whisperx.load_align_model(
        language_code=result["language"], device=device)
    result = whisperx.align(result["segments"], align_model, metadata,
                             audio, device, return_char_alignments=False)

    lines = []
    for segment in result["segments"]:
        words = [
            {
                "word": w.get("word", "").strip(),
                "start": round(w.get("start", segment.get("start", 0.0)), 3),
                "end": round(w.get("end", segment.get("end", 0.0)), 3),
            }
            for w in segment.get("words", [])
        ]
        lines.append({
            "text": segment.get("text", "").strip(),
            "start": round(segment.get("start", 0.0), 3),
            "end": round(segment.get("end", 0.0), 3),
            "words": words,
        })
    return lines


def _sync_raw(audio_path: str, model_size: str, language: str | None,
              engine: str) -> list:
    if engine == "whisperx":
        try:
            return sync_with_whisperx(audio_path, model_size, language)
        except ImportError:
            print("whisperx не установлен — откатываюсь на whisper. "
                  "Установить: pip install whisperx")
        except Exception as e:
            print(f"whisperx завершился с ошибкой ({e}) — откатываюсь на whisper.")
    return sync_with_whisper(audio_path, model_size, language)


def sync_existing_lyrics_with_whisper(audio_path: str, lyrics_path: str,
                                       model_size: str = "medium",
                                       language: str | None = None,
                                       engine: str = "whisper") -> list:
    """
    Если текст уже есть (из тегов/LRC) и нужно только выровнять его
    по времени — прогоняем распознавание+алаймент по аудио (даёт точные
    тайминги) и, если есть готовый текст, используем его только для
    сверки/замены орфографии построчно (эвристически по порядку строк).
    """
    lines = _sync_raw(audio_path, model_size, language, engine)

    given_text = Path(lyrics_path).read_text(encoding="utf-8")
    given_lines = [l.strip() for l in given_text.splitlines() if l.strip()]

    # Если количество строк совпадает — подставляем "эталонный" текст,
    # оставляя тайминги
    if len(given_lines) == len(lines):
        for wl, gl in zip(lines, given_lines):
            wl["text"] = gl

    return lines


def main():
    parser = argparse.ArgumentParser(description="Синхронизация текста песни с аудио")
    parser.add_argument("audio", help="vocals.wav")
    parser.add_argument("--lyrics", default=None,
                         help="lyrics.txt (если есть готовый текст для сверки)")
    parser.add_argument("output", nargs="?", default="lyricsSync.json")
    parser.add_argument("--whisper-model", default="medium")
    parser.add_argument("--language", default=None)
    parser.add_argument("--engine", default="whisper", choices=["whisper", "whisperx"],
                         help="whisper (быстро) или whisperx (точнее, forced alignment)")
    args = parser.parse_args()

    if args.lyrics:
        lines = sync_existing_lyrics_with_whisper(
            args.audio, args.lyrics, args.whisper_model, args.language, args.engine)
    else:
        lines = _sync_raw(args.audio, args.whisper_model, args.language, args.engine)

    with open(args.output, "w", encoding="utf-8") as f:
        json.dump(lines, f, ensure_ascii=False, indent=2)

    print(f"Синхронизировано {len(lines)} строк -> {args.output} (движок: {args.engine})")


if __name__ == "__main__":
    main()
