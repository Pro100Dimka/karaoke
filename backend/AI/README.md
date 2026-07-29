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

## Дополнительные шаги (последний раунд улучшений)

- **Нормализация громкости** (`build/convert.py: normalize_loudness`) — все
  дорожки после Demucs приводятся к -16 LUFS перед анализом (EBU R128,
  через встроенный ffmpeg loudnorm), чтобы пороги в VAD/pitch не плавали
  между тихо и громко сведёнными треками.
- **Адаптивный порог тишины** (`analyze/breath.py`) — `top_db` теперь
  считается из реального шумового пола конкретного трека, а не берётся
  фиксированной константой.
- **Структурная сегментация** (`analyze/structure.py`) — автоматическое
  разбиение песни на блоки (куплет/припев и т.п.) через self-similarity
  по хрома+MFCC признакам. Результат — `structure.json` +
  `difficultyByStructure.json` (карта сложности по структурным блокам,
  в дополнение к покуплетной `difficulty.json`).
- **Человекочитаемый отчёт** (`build/report.py`) — `report.md` с ключевыми
  цифрами (BPM, тональность, вокальный диапазон, сложность), чтобы не
  копаться в JSON вручную.
- **Тесты** (`tests/`) — покрывают сегментацию нот, коррекцию октавных
  ошибок и квантизацию MIDI на синтетических данных. Запуск:
  ```bash
  pip install pytest
  pytest tests/ -v
  ```

# Что исправлено (2026-07-29)

## 1. Пропадающие/неправильные ноты вокала — исправлено и пересчитано на реальных данных

**Файл:** `src/build/reference.py`

**Причина:** `voiced_flag` из pYIN — это решение Viterbi/HMM по всей
последовательности (учитывает соседние кадры), а не простое "confidence > 0.5".
Поэтому на тихих/приглушённых участках (после сепарации вокала, дыхание,
концы фраз) `voiced_probs` мог быть стабильно низким (0.05-0.2), хотя кадр
реально был voiced. Старый фиксированный порог `confidence_threshold=0.4`
вырезал такие участки целиком — отсюда пропавшие куски мелодии
(в частности, вторая половина второго куплета).

**Фикс:** порог теперь по умолчанию считается АДАПТИВНО под конкретную
песню (перцентиль confidence среди voiced-кадров, зажатый в разумный
коридор), а не одной жёсткой цифрой на все записи. Старое поведение
доступно через `--confidence 0.4`.

**Пересчитано в этом архиве на вашем реальном `pitch.json`:**

- `Song/TRITIA-31-я весна/reference.json` — было 139 нот, стало 346,
  дыры на 50с/75с/120с/140с (в т.ч. пропавшая вторая половина второго
  куплета) заполнены.
- `difficulty.json`, `difficultyByStructure.json`, `songMap.json`,
  `report.md` (раздел "Вокал" и "Сложность") — пересобраны из нового
  `reference.json`.

**⚠️ Не пересчитано** (нужен `pretty_midi`, которого нет в этой
песочнице — установите и прогоните у себя):

```
python -m src.build.midi "Song/TRITIA-31-я весна/reference.json" ^
  "Song/TRITIA-31-я весна/melody.mid" ^
  --music "Song/TRITIA-31-я весна/music.json" --quantize
```

Текущий `melody.mid` в архиве — СТАРЫЙ, собран по старому reference.json (139 нот).

## 2. Тональность (детектилось G minor вместо G#) — код исправлен, НЕ проверено на аудио

**Файл:** `src/analyze/music.py`, функции `compute_boundary_chroma` / `estimate_key`

**Гипотеза:** усиление хромы начала/конца трека (`boundary_weight=1.5`)
раньше не учитывало громкость — если интро/аутро тихие/шумные (в вашей
песне это отдельные короткие блоки ~1с и ~6с по structure.json), это
могло утянуть оценку тоники в сторону. Теперь такие тихие кадры
отфильтровываются перед усреднением boundary-хромы.

**⚠️ Это не подтверждено на реальном аудио** — в этой среде нет сети,
чтобы установить librosa и прогнать анализ заново. Нужно перезапустить
у себя и посмотреть, что покажет `music.json` теперь:

```
python -m src.analyze.music "Song/TRITIA-31-я весна/separated/instrumental.wav" ^
  "Song/TRITIA-31-я весна/music.json"
```

## 3. Размер такта (детектилось 3/4 вместо 4/4) — код исправлен, доказано на синтетике

**Файл:** `src/analyze/music.py`, функция `estimate_time_signature`

**Причина (доказана математически):** автокорреляция onset-огибающей
естественно затухает с ростом лага, поэтому лаг "3 доли" почти всегда
получает более высокое СЫРОЕ значение автокорреляции, чем лаг "4 доли",
просто потому что он короче — независимо от истинного размера такта.
Это системно смещало результат в пользу 3/4.

Проверено на синтетическом сигнале с настоящей 4-дольной периодичностью
и без 3-дольной: старый метод (сырое значение) ошибочно выбирал 3/4,
новый метод (выступ пика над локальным фоном) — верно выбирал 4/4.

**⚠️ Тоже требует перезапуска на вашем аудио** (та же команда, что и выше,
`music.json` содержит и тональность, и размер такта).

## Как пересчитать всё после установки зависимостей

```
pip install -r requirements.txt
python -m src.analyze.music "Song/TRITIA-31-я весна/separated/instrumental.wav" "Song/TRITIA-31-я весна/music.json"
python -m src.build.midi "Song/TRITIA-31-я весна/reference.json" "Song/TRITIA-31-я весна/melody.mid" --music "Song/TRITIA-31-я весна/music.json" --quantize
python -m src.build.report "Song/TRITIA-31-я весна"
```

(reference.json/difficulty\*.json/songMap.json уже пересчитаны в этом архиве и трогать их не нужно, если вы не меняли pitch.json)
