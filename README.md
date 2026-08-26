# A&D Voice

A&D Voice — Windows desktop-приложение для локальной подготовки песен к караоке, исполнения, редактирования вокальной мелодии, записи и анализа исполнения, а также совместного пения в онлайн-комнатах.

Основной пользователь — человек, который хранит собственную библиотеку песен на компьютере и хочет пройти полный цикл без облачной обработки аудио:

**добавить аудиофайл → подтвердить название/исполнителя → обработать песню локальным AI → получить минус, вокальный reference и синхронизированный `lyricsSync.json` → открыть песню в караоке → при необходимости исправить текст/ноты в Melody Editor → петь/записываться → просмотреть анализ исполнения.**

Онлайн-комнаты добавляют второй сценарий: **создать/войти в комнату → обменяться состоянием библиотеки → при необходимости передать другому участнику готовый пакет песни → синхронно запустить караоке → передавать голос между клиентами по WebRTC**. Сигналинг комнаты работает через Cloudflare Worker, поэтому онлайн-комнаты требуют интернет; AI-обработка песни при этом остаётся локальной.

---

## 1. Что проект должен делать

### 1.1. Локальная библиотека песен

Главная страница приложения — библиотека. Пользователь может:

- добавить один или несколько аудиофайлов;
- перед созданием песни проверить/исправить автоматически определённые `title` и `artist`;
- выбрать режим обработки;
- видеть состояние `pending / queued / processing / cancelling / done / cancelled / error` и прогресс обработки;
- отменить обработку;
- переобработать песню целиком либо перестроить мелодию/синхронизацию из уже существующего `vocals.flac`;
- изменить метаданные песни и параметры отображения;
- открыть папку песни в Electron;
- открыть записи исполнения;
- удалить песню вместе с её файлами.

Backend хранит каталог песен в SQLite и файловой библиотеке. В dev-режиме база по умолчанию находится в `data/app.db`, песни — в `karaoke_songs/`. Пути могут быть изменены через настройки.

### 1.2. AI-обработка песни

Актуальный pipeline реализован в `backend/AI/pipeline.py` и состоит из следующих логических этапов:

1. декодирование исходного файла через FFmpeg;
2. разделение микса на вокал и инструментал через MSST / Mel-Band RoFormer;
3. очистка и перевод вокального reference в mono;
4. параллельный анализ инструментала для BPM/тональности;
5. определение pitch вокала через TorchFCPE и стабилизация pitch;
6. получение текста: переданный пользователем текст → поиск текста → ASR fallback;
7. forced alignment текста с вокалом;
8. привязка слов к реально озвученным интервалам;
9. построение нот внутри слов;
10. валидация итогового документа;
11. атомарная публикация итоговых файлов.

Для новой полностью обработанной песни каноническими AI-артефактами являются:

```text
<song-dir>/
├─ instrumental.flac
├─ vocals.flac
├─ lyricsSync.json
└─ cover.jpg / cover.png      # только если обложка существует
```

`lyricsSync.json` — **единый source of truth для синхронизации текста и вокальной мелодии**. В нём находятся как минимум:

- `title` и `artist` после финализации backend;
- `bpm`;
- `duration`;
- `key`;
- `reference_audio` (`vocals.flac`);
- полный `text`;
- `words[]`;
- внутри каждого слова — `notes[]` с MIDI-нотой, `start` и `end`.

Нота обязана иметь `end > start`, находиться внутри временных границ своего слова и не нарушать структурные правила `lyricsSync.json`. Melody Editor читает и сохраняет изменения через backend обратно в этот документ.

После успешной обработки временные каталоги AI (`logs`, `separated`, `.ai-cache`) удаляются, если они остались в output-каталоге. Backend может также оптимизировать файлы песни после финализации.

### 1.3. Поиск и синхронизация текста

Если пользователь не передал собственный текст, pipeline сначала пытается найти текст по названию песни. Если поиск не дал результата, используется ASR. Для синхронизации используется forced aligner; для русского и украинского присутствуют CTC-модели, а основной forced aligner — Qwen3 Forced Aligner. При разрешённом fallback pipeline способен использовать равномерное текстовое выравнивание вместо аварийного завершения.

### 1.4. Melody Editor

Маршрут `#/editor/:songId` открывает редактор вокальной мелодии. Он получает данные через `GET /songs/{id}/editor`, а изменения сохраняет через `PUT /songs/{id}/editor`.

Редактор предназначен для ручной правки:

- нот и их временных границ;
- текста отдельных слов;
- временных границ слов;
- объединения/редактирования нот;
- сброса ручных изменений к сгенерированному состоянию.

Сохранение редактора изменяет данные песни через backend, а не создаёт отдельный MIDI-файл как основной источник данных.

### 1.5. Караоке

Маршрут `#/karaoke` открывает рабочее пространство исполнения. Frontend загружает данные песни и синхронизации через backend, использует аудиотреки песни и отображает текст/ноты во времени.

Караоке поддерживает связанные с кодом проекта функции:

- play / pause / stop / seek;
- синхронизацию позиции;
- отображение текста и нот;
- изменение темпа и транспонирование в UI;
- управление громкостью музыкального и вокального слоёв;
- работу с микрофоном;
- запись исполнения;
- эффекты микрофона (включая reverb / echo / delay на пути записи);
- переход к анализу записи;
- синхронизацию действий через online room, когда пользователь находится в комнате.

### 1.6. Запись и анализ исполнения

Backend предоставляет отдельный recording API. Пользователь может:

1. начать запись для конкретной песни с текущей позиции;
2. поставить запись на паузу;
3. продолжить;
4. остановить;
5. получить сохранённую запись и performance-файл;
6. открыть список записей песни;
7. запустить анализ;
8. получить accuracy, deviation и данные по секциям;
9. удалить запись.

Записи принадлежат песне и хранятся в файловом каталоге песни, а метаданные — в SQLite.

### 1.7. Аудиоустройства и мониторинг

Backend умеет перечислять input/output-устройства, ASIO-драйверы, сохранять настройки аудио, выбирать устройства, запускать/останавливать direct monitoring и возвращать оценку качества сигнала.

В настройках UI доступны, среди прочего:

- устройство вывода;
- микрофон;
- тест динамиков;
- direct monitoring;
- громкость мониторинга до `200%` (`0..2`);
- noise suppression;
- режим вычислений AI (`auto`, `cuda`, `cpu`);
- число CPU threads;
- каталоги песен, AI-моделей и кэша.

### 1.8. Онлайн-комнаты

Комнаты состоят из двух уровней:

- **Cloudflare Worker + Durable Object** — WebSocket-сигналинг, участники, host capability, синхронизация команд и состояния комнаты;
- **WebRTC peer mesh** на клиентах — голос и бинарные передачи между участниками.

Frontend по умолчанию подключается к:

```text
wss://karaoke-studio-online.pro100dimka-and.workers.dev
```

Создатель генерирует room id и криптографический host token. Участники получают room-state, события join/leave и сигнальные сообщения для WebRTC.

Если выбранной песни нет локально у участника или revision отличается, клиент может запросить у владельца **готовый package песни**. Backend экспортирует пакет через `GET /songs/{id}/package`, другой клиент принимает бинарный файл по WebRTC data channel и импортирует его через `POST /songs/package/import`. Команда запуска песни должна продолжаться после успешной доставки/импорта нужной revision, а не запускать отсутствующий локальный файл.

### 1.9. Радио

Приложение имеет отдельный radio context. Радио можно включать/выключать, выбирать станцию и менять громкость. При комнате состояние радио может синхронизироваться с room-командами.

### 1.10. Настройки, диагностика, история и обслуживание

Модальное окно Settings содержит вкладки:

- **Общее** — имя в сети, язык, тема, радио;
- **Звук** — устройства, мониторинг и параметры микрофона;
- **Обработка** — compute mode, threads, пути, состояние AI-моделей;
- **Дополнительно** — сервисные экраны Memory, History, Diagnostics, About.

Backend предоставляет health/model/version/error endpoints, управление кэшем, историю и настройки приложения.

---

## 2. Главные пользовательские сценарии

Ниже перечислены цепочки, которые следует считать основными E2E-сценариями проекта. При регрессионном тестировании нужно проверять не только отдельный экран, а всю цепочку и итоговые данные на диске/в backend.

### E2E-01. Первый запуск development-версии

`start-dev.bat` → bootstrap Python/venv/AI/ASIO/frontend → FastAPI на `127.0.0.1:18000` → Vite на `127.0.0.1:5173` → Electron → Library загружается и backend health доступен.

### E2E-02. Добавление и обработка новой песни

Library → Add song → выбор файла → `/songs/identity` → проверка `title/artist` → `POST /songs` → `POST /songs/{id}/process` → polling status → `done` → карточка становится доступной для Karaoke → на диске существуют `instrumental.flac`, `vocals.flac`, `lyricsSync.json`.

### E2E-03. Добавление нескольких файлов

Выбор нескольких файлов → последовательная проверка identity каждого → подтверждение/пропуск каждого draft → создание подтверждённых песен → запуск обработки каждой → каждая песня независимо появляется в библиотеке.

### E2E-04. Ошибка обработки

Добавление песни → processing → ошибка AI/FFmpeg/model → status=`error` + `error_message` → UI показывает ошибку и лог → библиотека остаётся рабочей → пользователь может повторить обработку или удалить песню.

### E2E-05. Отмена обработки

Processing → Cancel → `POST /songs/{id}/cancel` → `cancelling` → `cancelled` → worker освобождает processing slot → следующая песня в очереди может продолжить работу.

### E2E-06. Полная повторная обработка

Готовая песня → Process again → подтверждение → pipeline заново обновляет generated results → metadata/revision обновляются → Karaoke открывает новую версию.

### E2E-07. Переобработка мелодии без нового separation

Готовая песня → Reprocess melody → backend требует существующие `vocals.flac` + `lyricsSync.json` → повторный pitch/alignment/notes → обновлённый `lyricsSync.json` → `instrumental.flac` остаётся доступным.

### E2E-08. Ручное редактирование песни

Library → Song settings → Melody Editor → загрузка `/songs/{id}/editor` → изменение ноты/слова/границы → Save → `/songs/{id}/editor` PUT → повторное открытие → изменения сохранены и используются Karaoke.

### E2E-09. Сброс Melody Editor

Editor → ручные изменения → Reset → `/songs/{id}/editor/reset` → данные возвращаются к состоянию, которое backend считает исходным/сгенерированным для редактора.

### E2E-10. Запуск готовой песни в караоке

Library → ready song → Karaoke → загрузка result/timeline/audio → instrumental начинает воспроизводиться → текст и piano-roll движутся по общей временной шкале → play/pause/seek/stop не расходятся с текущей позицией.

### E2E-11. Изменение темпа/тональности при исполнении

Karaoke → изменение tempo/key/transpose → playback и отображаемая мелодия используют выбранные параметры → возврат/повторное открытие не повреждает базовый `lyricsSync.json` без явного сохранения metadata/editor.

### E2E-12. Запись исполнения

Karaoke → Record → `POST /recording/start` с song id и текущей позицией → pause/resume при необходимости → stop → запись появляется в списке этой песни → файл доступен через recording API.

### E2E-13. Запись с микрофонными эффектами

Karaoke → настроить music/microphone volume, reverb, echo, delay → начать и завершить recording → backend создаёт performance mix с переданными параметрами → результат можно воспроизвести.

### E2E-14. Анализ исполнения

Library/Karaoke → открыть запись → Run analysis → `POST /analysis/{recordingId}/run` → получить общий результат → accuracy/deviation/sections доступны → modal анализа показывает результат.

### E2E-15. Удаление записи

Список записей песни → Delete → `DELETE /recording/{id}` → запись исчезает из БД/списка и связанный пользовательский файл удаляется согласно backend lifecycle.

### E2E-16. Выбор аудиоустройств

Settings → Audio → получить input/output devices → выбрать динамики/микрофон → сохранить → повторно открыть settings → выбранные значения восстановлены → Karaoke/recording используют актуальные настройки.

### E2E-17. Direct monitoring микрофона

Settings → включить monitoring → `/audio/direct-monitor/start` → изменить monitoring volume/noise suppression → выключить → `/audio/direct-monitor/stop` → worker/устройство корректно освобождены.

### E2E-18. Смена путей хранения

Settings → изменить songs/cache/models folder → backend применяет и сохраняет path settings → следующий запуск использует сохранённые пути → старый допустимый library root остаётся распознаваемым для миграции/импорта.

### E2E-19. Очистка и оптимизация кэша

Settings/Memory → получить cache size/free space → clear/delete temp → оптимизировать песню → транзакционное восстановление не оставляет библиотеку в частично опубликованном состоянии.

### E2E-20. Создание онлайн-комнаты

Library → Online Room → ввести online name → Create → WebSocket connect к Worker → room-state → dock показывает комнату и self → отсутствие разрешения на микрофон не должно разрушать саму комнату.

### E2E-21. Подключение второго клиента

Client A Create room → Client B Join по room id → оба получают актуальных participants → join/leave отражается на обоих клиентах → host capability остаётся у создателя.

### E2E-22. Голос между участниками

Два клиента в комнате → WebRTC signaling → peer connection/audio track → речь A слышна у B и наоборот → mute, participant volume и локальные эффекты применяются к нужному участнику, а не ко всей комнате.

### E2E-23. Выбор песни, которая уже есть у всех

Host выбирает песню → revision у участников совпадает → package не передаётся → синхронная room-команда открывает/запускает ту же песню на клиентах с общей серверной временной базой.

### E2E-24. Выбор песни, которой нет у гостя

Host выбирает песню → guest обнаруживает отсутствие/revision mismatch → guest запрашивает package у владельца → owner экспортирует `/songs/{id}/package` → WebRTC transfer → guest импортирует `/songs/package/import` → revision подтверждена → только затем выполняется команда запуска.

### E2E-25. Обрыв передачи песни

Transfer package → sender/receiver disconnect, timeout или file error → transfer отменяется и очищает временный sink → пользователь остаётся в комнате, если сама room-связь жива → зависшая команда песни не должна запускаться как успешная.

### E2E-26. Room playback synchronization

Host play/pause/seek/stop или выбирает песню → room command содержит идентификатор/время → guests применяют только актуальную команду → clock offset от ping/pong используется для выравнивания времени.

### E2E-27. Синхронизация радио в комнате

Radio включено → изменение состояния/станции/позиции владельцем команды → `RoomRadioSync` применяет актуальное состояние на других клиентах → mute room/application audio не ломает основное Karaoke audio state.

### E2E-28. Удаление песни

Library → Delete song → confirmation → `DELETE /songs/{id}` → карточка сразу скрывается → backend удаляет БД-запись и принадлежащие песне ресурсы → связанные UI state (processing/recordings) закрываются.

---

## 3. Точные команды запуска и проверки

Все команды ниже взяты из существующих `.bat`, `package.json`, `pyproject.toml`, Playwright/Vitest/Stryker и release scripts этой версии проекта.

### 3.1. Полный development-запуск — рекомендуемый путь

Из корня проекта в **Windows cmd.exe**:

```bat
start-dev.bat
```

Что делает скрипт:

- проверяет `backend/` и `front/`;
- восстанавливает локальный Python 3.12.10 при необходимости;
- создаёт `backend\venv`;
- устанавливает backend/dev dependencies;
- запускает bootstrap frontend, ASIO и AI параллельно;
- восстанавливает AI-модели/движки;
- освобождает dev-порты `18000` и `5173`;
- запускает `npm run dev:electron`.

Только подготовить зависимости, ничего не запускать:

```bat
start-dev.bat --prepare-only
```

### 3.2. Web-режим

Из корня:

```bat
start-web.bat
```

Frontend script, который лежит под этим wrapper:

```bat
cd front
npm run dev:web
```

### 3.3. Frontend отдельно

```bat
cd front
npm install
npm run dev
```

Electron development:

```bat
cd front
npm run dev:electron
```

Mock frontend:

```bat
cd front
npm run dev:mock
```

Production frontend build:

```bat
cd front
npm run build
```

### 3.4. Backend отдельно

После подготовки venv:

```bat
cd backend
venv\Scripts\python.exe run.py
```

`backend/run.py` — фактическая точка запуска Uvicorn: он настраивает логирование, single-instance lock и запускает `app.main:app` на host/port из `config.py`. Для полного desktop development всё равно предпочтителен `start-dev.bat`.

### 3.5. Полная проектная проверка

Из корня:

```bat
scripts\check.bat
```

Этот gate последовательно запускает:

```text
frontend npm run verify
frontend unit coverage
frontend mutation tests
frontend Playwright E2E
npm audit для front
npm audit для cloudflare
Cloudflare unit tests
backend static/architecture check
backend semantic-density audit
backend pytest + coverage
pip check
pip-audit
```

### 3.6. Backend проверки вручную

```bat
cd backend
venv\Scripts\python.exe ..\scripts\backend\check.py
venv\Scripts\python.exe ..\scripts\backend\audit_semantic_density.py
venv\Scripts\python.exe -m pytest -q --cov=app --cov=AI --cov=config --cov=database --cov=models --cov=schemas --cov-report=term
venv\Scripts\python.exe -m pip check
venv\Scripts\python.exe -m pip_audit --ignore-vuln PYSEC-2025-217 --ignore-vuln PYSEC-2026-2288 --ignore-vuln PYSEC-2026-2289 --ignore-vuln PYSEC-2026-2290
```

`check.py` дополнительно запускает:

```bat
python scripts\backend\audit_distribution.py
python -m compileall -q app AI config.py database.py models.py schemas.py run.py
python -m ruff check .
python -m mypy app config.py database.py models.py schemas.py run.py
python scripts\backend\audit_architecture.py
```

### 3.7. Frontend unit / lint / audit

```bat
cd front
npm run lint
npm run format:check
npm run check:imports
npm run check:syntax
npm run test:unit
npm run test:unit:coverage
npm run audit
npm run verify
```

Порог Vitest coverage из `vitest.config.mjs`:

```text
statements >= 80%
branches   >= 75%
functions  >= 80%
lines      >= 80%
```

### 3.8. Mutation tests

Release mutation gate:

```bat
cd front
npm run test:mutation
```

Полный вариант, включая static mutants:

```bat
cd front
npm run test:mutation:full
```

Stryker использует Vitest runner, per-test coverage и параллелизм. Release threshold `break` = `75`, target/high = `90`.

### 3.9. Browser E2E

```bat
cd front
npm run test:e2e
```

Playwright test directory:

```text
front/tests/e2e
```

В текущем наборе browser E2E явно проверяются минимум:

- загрузка Library;
- import → visible processing flow;
- создание комнаты без microphone permission;
- persisted Settings;
- открытие полного Karaoke workspace;
- загрузка Melody Editor;
- сохранение merged note после повторного открытия.

Integration вариант против backend:

```bat
cd front
npm run test:e2e:real
```

или эквивалент:

```bat
npm run test:integration:backend
```

### 3.10. Electron release-critical E2E

```bat
cd front
npm run test:e2e:electron-release
```

Эта конфигурация запускается с `workers: 1` и проверяет, в частности, localhost media authentication и HTTP Range в реальном Electron media element.

### 3.11. Cloudflare Worker

```bat
cd cloudflare
npm install
npm test
npm run check
```

Локальный Worker:

```bat
npm run dev
```

Deploy:

```bat
npm run deploy
```

`npm run check` выполняет `wrangler deploy --dry-run`.

### 3.12. Release gate

Из корня:

```bat
verify-release.bat
```

Либо напрямую:

```bat
backend\venv\Scripts\python.exe scripts\release_gate.py
```

Release gate требует установленный `front/node_modules`, необходимые frontend test dependencies и Cloudflare dependencies. Он запускает:

1. backend static/architecture gate;
2. backend full pytest + coverage с `--cov-fail-under=85`;
3. frontend `verify`;
4. mutation gate;
5. browser E2E;
6. Electron release E2E;
7. Cloudflare tests;
8. Cloudflare `npm audit`;
9. Cloudflare deployment dry-run.

Успешный gate кэшируется по fingerprint тестируемых исходников. Для принудительного полного повторного gate используется переменная:

```bat
set KARAOKE_RELEASE_FULL=1
verify-release.bat
```

### 3.13. Сборка установщика

Публичная команда:

```bat
build-installer.bat
```

В проекте также есть вариант, который осознанно пропускает release gate:

```bat
build-installer-no-checks.bat
```

Его нельзя считать production-проверкой: он предназначен только для явной сборки без обязательных тестов.

Основная реализация builder находится в:

```text
scripts/build-installer.ps1
```

Builder проверяет Node/npm, FFmpeg и Windows build tooling, собирает backend PyInstaller, native audio/ASIO, frontend, Electron и Windows installer/ISO-артефакты.

---

## 4. Версии окружения и зависимостей

### 4.1. Целевая ОС

Фактический основной target проекта — **Windows 10/11 x64-compatible**:

- root tooling написан на `.bat` / PowerShell;
- installer использует Inno Setup script;
- `ArchitecturesAllowed=x64compatible`;
- installer прямо требует Windows `tar.exe` и сообщает, что нужен Windows 10/11;
- присутствует native ASIO bridge.

`electron-builder` содержит также декларации `mac: dmg` и `linux: AppImage`, но текущий полный bootstrap/release/ASIO/installer pipeline ориентирован на Windows и не подтверждает эквивалентный production flow для macOS/Linux.

### 4.2. Версия приложения

Основные package metadata:

```text
frontend package.json: 0.3.34
backend pyproject.toml: 0.3.34
cloudflare package.json: 0.3.5
```

**Известное расхождение:** `backend/app/main.py` создаёт FastAPI с `version="0.3.5"`. Поэтому версию всего desktop-приложения следует брать из синхронизированных `front/package.json` и `backend/pyproject.toml`, а значение FastAPI сейчас считать отдельным несоответствием исходников.

### 4.3. Node.js / npm

Pinned development Node:

```text
front/.nvmrc       = 22.18.0
front/.node-version = 22.18.0
```

Допустимый диапазон из `front/package.json`:

```text
>=22.18.0 <23 || >=24.11.0
```

`start-dev.bat` и installer builder проверяют этот диапазон.

Версия npm отдельно в репозитории не pinned. Используется npm вместе с выбранным Node; точные npm dependency resolutions зафиксированы `front/package-lock.json` и `cloudflare/package-lock.json`.

### 4.4. Python

Project metadata:

```text
backend pyproject: >=3.11,<3.13
mypy target:       Python 3.12
start-dev runtime: Python 3.12.10
```

`start-dev.bat` автоматически скачивает portable/local runtime **Python 3.12.10** из NuGet и создаёт `backend/venv`.

`scripts/check.bat` допускает найденный Python 3.12, а при его отсутствии — Python 3.11.

### 4.5. PyTorch / CUDA

`scripts/install-ai-models.bat` pin-ит:

```text
torch       2.8.0
torchvision 0.23.0
torchaudio  2.8.0
CUDA wheels cu126 (CUDA 12.6)
```

Если NVIDIA GPU не обнаружена, bootstrap ставит CPU wheels. Runtime выбирает `cuda`, когда `torch.cuda.is_available()`, иначе `cpu`.

В текущей реализации:

- separation: PyTorch CUDA/CPU;
- pitch: PyTorch/TorchFCPE CUDA/CPU;
- ASR и aligner: PyTorch; на CUDA используются FP16, на CPU FP32;
- CTC alignment: PyTorch/torchaudio.

### 4.6. FFmpeg

FFmpeg обязателен для decode/preprocess/recording и installer build проверяет наличие `ffmpeg.exe`.

**Точная версия FFmpeg в репозитории не pinned.** Не следует писать конкретную версию в требованиях без проверки реальной development/build machine. Диагностика backend умеет вернуть фактическую строку версии установленного FFmpeg.

### 4.7. Backend Python dependencies

Главные runtime ranges из `backend/requirements-api.txt`:

```text
fastapi             >=0.115,<1
uvicorn[standard]    >=0.30,<1
python-multipart     >=0.0.9,<1
sqlalchemy           >=2.0,<3
pydantic             >=2.8,<3
sounddevice          >=0.5,<1
soundfile            >=0.12,<1
numpy                >=1.26,<3
mutagen              >=1.47,<2
huggingface-hub      >=0.34,<2
```

AI requirements содержат, среди прочего:

```text
numpy                       >=1.26,<2
scipy                       >=1.11,<1.15
librosa                     >=0.10,<1
torchfcpe                    ==0.0.4
omegaconf                    ==2.2.3
ml-collections               ==1.1.0
beartype                     ==0.14.1
rotary-embedding-torch       ==0.3.5
qwen-asr                     ==0.0.6
transformers                 ==4.57.6
huggingface_hub[hf_xet]      >=0.34,<1.0
```

Dev tools:

```text
ruff       >=0.6,<1
mypy       >=1.11,<2
pip-audit  >=2.9,<3
pytest     >=9.0.3,<10
pytest-cov >=5,<7
```

`requirements*.txt` declare ranges, not exact pins — a fresh install can legitimately resolve to a newer compatible release. `backend/requirements-lock.txt` (generated with `pip freeze`) records the exact versions last verified to pass the full test suite; regenerate it after intentionally upgrading a dependency. `torch`/`torchvision`/`torchaudio` are pinned separately by `scripts\install-ai-models.bat` (exact versions plus a CUDA/CPU wheel index choice) and are not installed from either requirements file.

### 4.8. Frontend/Electron — фактически разрешённые lock-файлом версии

По текущему `front/package-lock.json`:

```text
React              18.3.1
React DOM          18.3.1
Electron           43.3.0
Vite               8.2.1
Vitest             4.1.10
Playwright         1.62.1
Stryker            9.6.1
electron-builder   26.15.3
```

Также используются React Query, React Router, Pixi, Three.js, WaveSurfer, XState, Zustand, Comlink и другие зависимости, полный resolution находится в `front/package-lock.json`.

### 4.9. Cloudflare

```text
Worker package version: 0.3.5
Wrangler lock version:   4.125.0
compatibility_date:      2026-08-03
Durable Object:          KaraokeRoom
R2 binding:              LOGS
```

### 4.10. База данных

Backend использует **SQLite через SQLAlchemy**. Основной dev-файл:

```text
data/app.db
```

База хранит сущности песен, записей, результатов анализа, playback state и связанные metadata. Аудио и крупные AI-артефакты хранятся в файловой системе, а не как BLOB в SQLite.

### 4.11. SBOM / лицензии

```bat
backend\venv\Scripts\python.exe scripts\backend\generate_sbom.py
cd front && npm run generate:sbom
```

Пишут `generated/sbom/backend.json` и `generated/sbom/frontend.json` — плоский список `{name, version, license}` по каждому установленному пакету (backend: `importlib.metadata`, без новых зависимостей; frontend: `npm ls --all --json --long`). `generated/` не коммитится — эти файлы предназначены для разового аудита лицензий/supply chain, а не как отслеживаемый артефакт.

### 4.12. OpenAPI ↔ frontend contract

Фронтенд — чистый JS (без TypeScript), поэтому вместо генерации типизированного клиента используется runtime-сверка:

```bat
cd front && npm run audit:openapi-contract
```

Парсит (через `@babel/parser`, без TS) каждый литеральный путь в `front/src/api/domains/*.js` и сверяет его с реальной OpenAPI-схемой (`app.openapi()` из работающего backend venv, без запуска сервера). Падает с ненулевым кодом, если фронтенд вызывает путь, которого нет в схеме backend — так был найден и удалён мёртвый `src/api/domains/models.js` (`/models/whisper*`, ни одного вызова из UI, ни одного соответствующего backend-роута). Отдельно, только информационно, печатает backend-эндпоинты без вызывающего кода в `src/api/domains` — не обязательно ошибка (могут использоваться иначе или быть намеренно не покрыты), но повод проверить при следующем ревью. Не входит в агрегированный `npm run audit`, так как требует рабочего `backend/venv`, которого может не быть в чисто frontend-окружении.

---

## 5. Структура репозитория

```text
karaoke-main/
├─ backend/                 FastAPI, SQLite, services, AI pipeline, tests
│  ├─ app/
│  │  ├─ routers/           HTTP API
│  │  ├─ services/          business/application logic
│  │  └─ utils/
│  ├─ AI/                   separation, pitch, ASR/alignment, lyrics, notes
│  └─ tests/                backend + AI tests
├─ front/
│  ├─ electron/             Electron main/preload/security/backend bootstrap
│  ├─ src/                  React application
│  ├─ tests/                unit/integration/E2E/release-E2E
│  └─ scripts/              frontend architecture/release audits
├─ cloudflare/              room signaling Worker + Durable Object
├─ scripts/                 bootstrap, release gate, build, installer, benchmarks
├─ start-dev.bat            основной dev entrypoint
├─ start-web.bat            web entrypoint
├─ verify-release.bat       release verification entrypoint
└─ build-installer.bat      production build entrypoint
```

Frontend имеет только три route-level страницы:

```text
#/                 Library
#/karaoke          Karaoke
#/editor/:songId   Melody Editor
```

Settings и Online Room открываются как модальные/overlay UI, а не отдельные route pages.

---

## 6. Backend API — карта возможностей

Основные группы endpoint'ов:

```text
/songs         библиотека, upload, process/reprocess/cancel, package, editor, audio
/player        timeline/sync/position/seek/pause/resume/stop
/recording     start/pause/resume/stop/library/files/delete
/analysis      анализ записи, accuracy/deviation/sections
/audio         устройства, ASIO, settings, monitoring, signal quality
/cache         size/free-space/clear/temp/optimize
/diagnostics   health/models/versions/errors/client-log
/settings      application settings
/preferences   namespaced preferences
/history       история
/about         информация о приложении
```

При запуске через Electron/dev launcher backend может требовать capability token в заголовке:

```text
X-ADVoice-Token
```

В `start-dev.bat` development token задаётся как `advoice-local-development`; production Electron использует runtime launch configuration.

---

## 7. AI-модели

Реестр `backend/AI/model_registry.py` в этой версии содержит:

```text
Qwen3 ASR                  Qwen/Qwen3-ASR-1.7B
Qwen3 Forced Aligner       Qwen/Qwen3-ForcedAligner-0.6B
Russian CTC aligner        jonatasgrosman/wav2vec2-large-xlsr-53-russian
Ukrainian CTC aligner      Yehor/wav2vec2-xls-r-300m-uk-with-small-lm
Mel-Band RoFormer          KimberleyJSN/melbandroformer / MelBandRoformer.ckpt
```

Registry содержит pinned Hugging Face revisions, а RoFormer checkpoint также имеет SHA-256. `install-ai-models.bat` восстанавливает модели и MSST engine в `downloads/`/models location и создаёт runtime environment.

MSST (`ZFTurbo/Music-Source-Separation-Training`) — сторонний движок, а не пакет из PyPI/npm; `scripts\install-msst-engine.bat` фиксирует его на конкретном commit SHA (переменная `COMMIT` в начале скрипта), а не на `refs/heads/main` — `scripts\patch-msst-engine.ps1` предполагает точную структуру `utils/model_utils.py` и падает, если апстрим её изменит, так что клон живой ветки мог бы незаметно подставить несовместимый код при следующем bootstrap. Обновление MSST — сознательное действие: поднять `COMMIT` и заново проверить, что патч всё ещё применяется.

Важно: старое утверждение о Qwen3-ASR-0.6B для этого архива неверно — текущий registry использует **Qwen3-ASR-1.7B**.

---

## 8. Что считать критическими инвариантами при аудите

При исправлении проекта нельзя считать задачу завершённой, если нарушен хотя бы один из этих контрактов:

1. `lyricsSync.json` остаётся каноническим источником текста, BPM/key и вокальных нот.
2. Ноты остаются внутри границ своих слов, имеют валидный порядок времени и не создают некорректный документ.
3. Готовая песня действительно имеет локально доступные `instrumental.flac`, `vocals.flac`, `lyricsSync.json`.
4. Status `done` не выставляется до успешной финализации файлов/metadata.
5. Ошибка/отмена обработки освобождает очередь и не блокирует следующую песню.
6. Ручные изменения Melody Editor сохраняются после закрытия/повторного открытия.
7. Karaoke использует актуальную revision песни и синхронизирует playback с визуальной временной шкалой.
8. Recording относится к правильной песне и корректно освобождает аудиоресурсы при stop/error/shutdown.
9. Удаление песни/записи не оставляет UI в состоянии, будто ресурс ещё существует.
10. Remote song нельзя считать готовой к запуску на клиенте, пока нужная revision package не получена и не импортирована.
11. Обрыв peer transfer не должен выкидывать пользователя из комнаты сам по себе и не должен приводить к ложному успешному запуску песни.
12. Room-команды должны быть защищены от устаревших command id / transfer id.
13. Electron media requests к локальному backend сохраняют authentication и Range semantics.
14. Пользовательские данные хранятся отдельно от replaceable application build artifacts.
15. Release build не считается проверенным, если обязательный release gate был пропущен.

---

