# Karaoke Pipeline

Полный пайплайн подготовки песни к караоке: от исходного mp3 до
готового проекта с разделённым вокалом/минусом, распознанным и
синхронизированным текстом, эталонной мелодией, MIDI-файлом и картой
сложности.

## Структура проекта

```
AI/
│
└── src/
    ├── analyze/
    │   ├── breath.py            # шаг 7 — анализ дыхания/пауз
    │   ├── music.py             # шаг 4 — BPM, тональность, размер
    │   └── vocal.py             # шаг 5 — pitch (F0) по кадрам
    │
    ├── build/
    │   ├── convert.py           # шаг 2 — конвертация в единый формат
    │   ├── midi.py              # шаг 12 — экспорт мелодии в MIDI
    │   ├── project.py           # шаг 13 — сборка финального проекта
    │   ├── reference.py         # шаг 6 — эталонная мелодия
    │   └── unified_song_map.py  # шаг 10 — общая карта песни
    │
    ├── evaluation/
    │   └── difficulty_map.py    # шаг 11 — карта сложности
    │
    ├── lyrics/
    │   ├── get_text.py          # шаг 8 — получение текста
    │   └── sync.py              # шаг 9 — синхронизация текста
    │
    └── preprocessing/
        ├── probe.py             # шаг 1 — проверка файла
        └── separate.py          # шаг 3 — разделение дорожек (Demucs)
│
├── README.md
├── requirements.txt
├── run_all.py
└── song.mp3
```

При запуске `run_all.py` результат (`songInfo.json`, `song.wav`,
`separated/`, `music.json`, `pitch.json`, `reference.json`, `breaths.json`,
`lyricsSync.json`, `songMap.json`, `difficulty.json`, `melody.mid`,
`manifest.json`) складывается прямо в `Song/`, рядом с папкой `src/`.

## Установка

```bash
# ffmpeg должен быть установлен в системе (ffmpeg.org) и быть в PATH
pip install -r requirements.txt
```

Модели Demucs и Whisper скачиваются автоматически при первом запуске
(нужен интернет). Для видеокарты (ускорение) убедитесь, что установлен
PyTorch с поддержкой CUDA — иначе всё будет работать на CPU, но медленнее.

## Запуск целиком

Из папки `AI/` (там, где лежит `run_all.py` и `song.mp3`):

```bash
python run_all.py song.mp3 --out Song --whisper-model medium --language ru
```

## Запуск отдельных шагов

Каждый модуль можно импортировать и вызывать отдельно — удобно для
отладки одного этапа:

```python
import sys
sys.path.insert(0, "Song")  # чтобы src.* импортировался

from src.preprocessing.probe import probe_file
from src.build.convert import convert
from src.preprocessing.separate import separate
from src.analyze.music import analyze_music
from src.analyze.vocal import analyze_vocal
from src.build.reference import build_reference
from src.analyze.breath import analyze_breath
from src.lyrics.get_text import get_lyrics
from src.lyrics.sync import sync_existing_lyrics_with_whisper
from src.build.unified_song_map import build_song_map
from src.evaluation.difficulty_map import build_difficulty_map
from src.build.midi import build_midi, add_tempo_and_key
from src.build.project import build_project
```

Либо каждый файл — самостоятельный CLI-скрипт (через `python -m` с учётом
пакета), например:

```bash
cd Song
python -m src.preprocessing.probe ../song.mp3 songInfo.json
python -m src.build.convert ../song.mp3 song.wav
python -m src.preprocessing.separate song.wav --out separated
python -m src.analyze.music separated/instrumental.wav music.json
python -m src.analyze.vocal separated/vocals.wav pitch.json
python -m src.build.reference pitch.json reference.json
python -m src.analyze.breath separated/vocals.wav breaths.json
python -m src.lyrics.get_text ../song.mp3 lyrics.txt --language ru
python -m src.lyrics.sync separated/vocals.wav --lyrics lyrics.txt lyricsSync.json --language ru
python -m src.build.unified_song_map --music music.json --reference reference.json \
    --lyrics-sync lyricsSync.json --breaths breaths.json --pitch pitch.json songMap.json
python -m src.evaluation.difficulty_map --reference reference.json --sections lyricsSync.json difficulty.json
python -m src.build.midi reference.json melody.mid --music music.json
python -m src.build.project . --song-info songInfo.json \
    --instrumental separated/instrumental.wav --vocals separated/vocals.wav \
    --pitch pitch.json --reference reference.json --lyrics-sync lyricsSync.json \
    --music music.json --breaths breaths.json --difficulty difficulty.json \
    --song-map songMap.json --midi melody.mid
```

## Примечания

- **Разделение дорожек** (`preprocessing/separate.py`) — самый тяжёлый
  по ресурсам этап, использует Demucs (`htdemucs`), требует PyTorch.
- **Pitch-анализ** (`analyze/vocal.py`) использует `librosa.pyin` —
  надёжный вариант без GPU. Для большей точности можно переключиться
  на пакет `crepe` (нейросетевой pitch tracker).
- **Текст и синхронизация** (`lyrics/get_text.py`, `lyrics/sync.py`)
  используют Whisper. Модель `medium` — разумный баланс скорости и
  качества; для более точной синхронизации попробуйте `large-v3`
  (медленнее).
- **MIDI-экспорт** (`build/midi.py`) требует `pretty_midi`, конвертирует
  `reference.json` в `melody.mid` — удобно открывать в любой DAW.
