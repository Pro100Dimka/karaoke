# Задание на исправление — Karaoke Studio

Источник: [AUDIT.md](AUDIT.md) (комплексный аудит, 91 категория, 763 файла). Это — исполняемый чек-лист по находкам аудита, без аналитической прозы. Каждый пункт: что сделать, где, как проверить.

---

## P0 — Blocker (сделать первым, ломает функциональность целиком)

- [ ] **P0-1.** `backend/AI/engines/device.py`, `pitch.py`, `ctc.py`, `text.py` — провести `role`/device через `selected_backend(role)` (уже реализовано в `separation.py`) во всех местах загрузки моделей вместо `torch.cuda.is_available()`. Проверка: выставить `compute_mode="cpu"`, убедиться что pitch/ASR/aligner/CTC реально не трогают CUDA (не только `separation`).
- [ ] **P0-2.** `backend/app/services/kfn_dataset_service.py:319` — заменить `config.FFMPEG_BIN` на `config.FFMPEG_EXE`. Проверка: тест `_write_embedded_audio` без мока, на реальном `.kfn` со встроенным аудио.

## P1 — Critical

- [ ] **P1-1.** `backend/database.py:174` (`_mark_interrupted_jobs`) — добавить `'CANCELLING'` в `WHERE status IN (...)`. Добавить переход `CANCELLING → QUEUED` в `ALLOWED_STATUS_TRANSITIONS` (`song_service.py`). Тест: убить процесс во время `CANCELLING`, перезапустить, убедиться что песня не зависает.
- [ ] **P1-2.** `backend/app/services/microphone_quality.py:108-137` (`RealtimePitchShifter.process`) — векторизовать через numpy или вынести в native-слой. Проверка: замер времени обработки одного блока на blocksize 64-256 при включённом pitch-shift.
- [ ] **P1-3.** `backend/app/services/recording_service.py:168-186` (`_callback`/`_monitoring_callback`) — обернуть тело в try/except с флагом ошибки (паттерн уже есть в `wasapi_monitor_stream.py`). Тест: намеренно бросить исключение внутри DSP-цепочки во время записи, убедиться что ошибка не проглатывается молча.
- [ ] **P1-4.** Настроить минимальный CI (self-hosted Windows runner), гоняющий `verify-release.bat`/`scripts/release_gate.py` на каждый merge в main.
- [ ] **P1-5.** `scripts/sign-windows.ps1:11-17` — сделать `ADVOICE_REQUIRE_SIGNING=1` дефолтом для `Mode=clean`/релизных сборок.

## P2 — High

- [ ] **P2-1.** `front/src/pages/Settings/use-settings.js:82-101` (`useAudio.update`) — откатывать `local[name]` при ошибке сохранения (`fail()` сейчас не откатывает).
- [ ] **P2-2.** `front/src/pages/Karaoke/components/console/mixer.jsx:59,70,87` + `useKaraokePreferences.js` + `useMicrophoneSettings.js` — использовать `onCommit` (уже есть в `RotaryKnob`) для персиста слайдеров/рукояток, `onChange` оставить только для визуала.
- [ ] **P2-3.** `front/src/pages/Karaoke/index.jsx:350-356` — fallback BPM (120) при отсутствии `lyrics_sync.bpm`, до использования в арифметике темпа.
- [ ] **P2-4.** `routers/songs.py:86-116` (`_queue_song_job`) — не восстанавливать статус вслепую при `started=False`; либо перечитывать актуальный статус из БД перед откатом.
- [ ] **P2-5.** `backend/app/services/song_service.py:532` (`delete_song`) — обернуть в `song_service.song_content_lock(song.id)` + `song_service.library_write_lock()`.
- [ ] **P2-6.** `backend/app/run.py:54-61` (`_UsefulLogFilter`/`_is_useful_record`) — расширить критерий, чтобы INFO-логи из `pipeline_service` ("AI stage started/finished", "Song processing started") попадали в `application.log`.
- [ ] **P2-7.** `backend/AI/cache.py` — реализовать реальное постоянство (сохранять `key()` рядом с выходами стадии и сверять) либо переименовать в `NoOpCache` с явным docstring.
- [ ] **P2-8.** `backend/AI/audio.py`, `vocal_preprocess.py` — выставить `timeout` во всех вызовах `run_ffmpeg`.
- [ ] **P2-9.** `backend/AI/install_models.py:67-81` — добавить sha256-проверку для основного веса каждого HF snapshot (сейчас только roformer проверяется).
- [ ] **P2-10.** `backend/AI/artifacts.py` (`publish_files_atomically`) — при старте/открытии песни проверять и предлагать восстановление осиротевших `*.bak`-файлов.
- [ ] **P2-11.** `backend/engines/separation.py:132-162` — ловить CUDA-сбой по типу/коду ошибки, не по текстовым подстрокам.
- [ ] **P2-12.** `scripts/release_gate.py:223-261` — включить `pip_audit` (с существующим ignore-листом из `check.bat`) в обязательный релизный гейт.
- [ ] **P2-13.** `scripts/install-asio-sdk.bat:11-12` — юридическая проверка источника ASIO SDK, рассмотреть официальный.
- [ ] **P2-14.** Добавить минимум один Playwright e2e-сценарий на реальном backend: импорт → обработка → редактор → караоке → комната → запись.
- [ ] **P2-15.** Добавить нагрузочный тест: библиотека из тысяч песен (backend) + много одновременных участников комнаты (Cloudflare DO).
- [ ] **P2-16.** `cloudflare/src/worker.js:408-420` + `onlineRoomActions.js:103-105` — персистить `start-karaoke` вместе с `playbackState`, чтобы гость не зависал в библиотеке после реконнекта в узком окне.
- [ ] **P2-17.** `cloudflare/src/worker.js:552-560` — задокументировать отсутствие host migration как продуктовое решение, либо реализовать передачу `hostToken`.
- [ ] **P2-18.** `cloudflare/src/roomIce.js:6-7` + `worker.js:649` (`/health`) — добавить поле `turnConfigured: Boolean(env.TURN_KEY_ID && env.TURN_KEY_API_TOKEN)`.
- [ ] **P2-19.** `front/electron/backend-process.cjs` — добавить периодический health-check (например `GET /diagnostics/health`) с рестартом backend после N таймаутов подряд.
- [ ] **P2-20.** `front/electron/rgb/controller.cjs:85-89`, `rgb/openrgb.cjs:34-41` — логировать ошибку (сообщение+stack) в catch-блоках вместо молчаливого проглатывания.
- [ ] **P2-21.** `front/package.json:15` — решить: либо сделать `build:lighting` некритичным шагом сборки (раз рантайм переживает отсутствие аддона), либо усилить надёжность самой сборки.
- [ ] **P2-22.** `backend/engines/wasapi/CMakeLists.txt:6-16` — закоммитить скачиваемые Node-API заголовки в репозиторий вместо загрузки с `raw.githubusercontent.com` при `cmake configure`.

## P3 — Medium

- [ ] **P3-1.** `backend/AI/pitch_post.py:10-35` (`stabilize_pitch`) — реализовать фильтрацию по `max_octave_jump` либо убрать параметр из сигнатуры.
- [ ] **P3-2.** `backend/AI/notes.py:52-89` — либо создавать безсловные ноты для сегментов без владельца, либо расширить `word_boundary_tolerance` динамически.
- [ ] **P3-3.** `backend/app/services/pipeline_service.py:987-990` (`_run_reprocessing`) — держать `song_content_lock` только вокруг `_clear_generated_results`/`recover_optimization_state`, не вокруг всего `_run_job`.
- [ ] **P3-4.** `backend/app/services/song_package_service.py:851-874` (`import_package`) — добавить проверку `pipeline_service.is_processing(song_id)` рядом с проверкой `has_active_recording`.
- [ ] **P3-5.** `cloudflare/src/worker.js:210-212,222` — синхронизировать критическую секцию проверки вместимости/роли host перед `acceptWebSocket`.
- [ ] **P3-6.** `cloudflare/src/onlineRoom.js:248` — передавать `hostToken` первым сообщением после установления соединения вместо query-параметра URL.
- [ ] **P3-7.** `front/src/components/KeyboardLighting.jsx:23,42` — кэшировать `--color-primary`, пересчитывать по `MutationObserver`/смене темы, а не каждые 50мс.
- [ ] **P3-8.** `front/src/pages/Settings/index.jsx:60-62` + `contexts/app-settings.jsx:62-64` — откатывать `applyTheme` при ошибке сохранения либо применять тему только после успеха.
- [ ] **P3-9.** Ввести токены `--z-*` (base/overlay/modal/toast) в `front/src/theme/ui/base.js`, заменить магические числа z-index по всему фронтенду.
- [ ] **P3-10.** `MONITORING.md` — либо удалить секцию про glitch-fallback → ASIO4ALL (не реализовано ни в одном production-пути), либо реализовать реальный источник события `fallback`.
- [ ] **P3-11.** `scripts/karaoke-studio.iss:77-102` — заменить статический `[UninstallDelete]`-список на `Type: filesandordirs; Name: "{app}"` с исключением `{app}\data`.
- [ ] **P3-12.** `cloudflare/src/worker.js:28-46` vs `front/src/contexts/onlineRoomEffects.js:3-24` — вынести `EFFECT_LIMITS` в общий источник правды либо добавить кросс-тест на их равенство (аналогично уже существующему прямому импорту `KaraokeRoom` в `room-transport-protocol.test.mjs`).
- [ ] **P3-13.** `backend/AI/lyrics_document.py:93` — не пропускать проверку перекрытия нот для `source=="kar"`.
- [ ] **P3-14.** `backend/app/services/song_service.py` / `song_package_service.py` — свести два независимых набора Windows-safe naming правил (`_windows_safe_component` и `_portable_destination_key`) в одну общую функцию.

## P3-доп — остальные находки Medium/Low (полный список, без сокращения)

Эти пункты были описаны в AUDIT.md Часть 3, но не попали в исходный выборочный список P3 — добавлены сейчас, чтобы покрытие было полным.

**Backend AI pipeline:**
- [ ] **P3d-1.** `backend/AI/engines/separation.py` (`_worker`/watchdog) — `psutil` импортируется в `try/except (ImportError, OSError): pass`; если недоступен, watchdog не запускается и осиротевший MSST-процесс может работать неограниченно при крахе родителя. Сделать `psutil` обязательной зависимостью либо добавить альтернативный watchdog-механизм.
- [ ] **P3d-2.** `ProcessingCancelledError` не проверяется внутри длинных forward-проходов ASR/aligner — прокинуть `cancelled`-callback вглубь `Qwen3Transcriber`/`Qwen3ForcedAligner`/`CTCWordAligner`.
- [ ] **P3d-3.** `backend/AI/utils/io.py` (`read_json`) — различать "файла нет" от "файл повреждён" (сейчас оба варианта молча превращаются в `default`).
- [ ] **P3d-4.** `backend/AI/pipeline.py` (`_release_engines`/`_park_engines`) — обернуть каждый `close()`/`park()` в собственный try/except, чтобы сбой одного движка не прерывал освобождение остальных.
- [ ] **P3d-5.** `backend/AI/service.py` — зафиксировать инвариант "не вызывать `close()`/`reset_ai_service()` из потока, уже удерживающего permit семафора" явным assert/комментарием.
- [ ] **P3d-6.** Нет обработки "GPU есть, но VRAM не хватает даже одной модели" для pitch/ASR/aligner (в отличие от separation) — добавить fallback на CPU по аналогии.
- [ ] **P3d-7.** `backend/AI/lyrics_sources.py` — 20-секундный бюджет не жёсткий (реально до ~28с), т.к. проверка дедлайна не прерывает уже стартовавший HTTP-запрос — сделать бюджет реальным потолком.

**Backend app/API:**
- [ ] **P3d-8.** `app_settings_service._normalize_writable_directory` — добавить таймаут на пробную запись файла (сейчас может подвесить HTTP-запрос на ОС-таймаут при недоступном сетевом диске).
- [ ] **P3d-9.** `pipeline_service._acquire_processing_slot` — добавить верхний таймаут ожидания слота с явным переходом в ERROR/повторной постановкой, чтобы зависший job во главе очереди не блокировал все остальные песни бесконечно.
- [ ] **P3d-10.** Добавить превентивную проверку свободного места на диске перед стартом обработки песни/загрузки моделей (сейчас только реактивно через `ENOSPC`).
- [ ] **P3d-11.** `main.py` (`lifespan()` finally) — вызывать `pipeline_service.cancel_all_active_processing()` и при обычном graceful shutdown (SIGTERM/Ctrl+C), не только через Electron-специфичный `/diagnostics/shutdown`.
- [ ] **P3d-12.** `metadata_enrichment_service.enqueue()` — ограничить число параллельных daemon-потоков общим семафором (сейчас до 8 одновременных ffmpeg-перекодирований видео сразу после старта).
- [ ] **P3d-13.** `metadata_enrichment_service.enrich_song` — обернуть запись в `output_dir` в `song_content_lock`/`library_write_lock` (тот же класс гонки, что и `delete_song`, P2-5).
- [ ] **P3d-14.** `schemas.py` — привести `tempo_override` к одному типу с `models.py` (ORM `Float` vs Pydantic `int`).
- [ ] **P3d-15.** `routers/application.py` (`PATCH /preferences/{namespace}`) — добавить хотя бы базовую валидацию структуры вместо полностью открытого `dict[str, Any]`.
- [ ] **P3d-16.** `song_service.song_folder_name` — учитывать длину абсолютного пути (не только имени папки, обрезанного до 180 символов) при формировании имени, чтобы не превышать `MAX_PATH=260` на системах без длинных путей.
- [ ] **P3d-17.** `pipeline_service._acquire_processing_slot` — добавить проверку `max_concurrent_jobs >= 1` при загрузке конфигурации, чтобы некорректное значение не приводило к вечному ожиданию без явной ошибки.
- [ ] **P3d-18.** `api/errors.py` (`http_error`) — рассмотреть сохранение типа исключения в маппинге вместо схлопывания всех причин одного типа на один HTTP-статус.
- [ ] **P3d-19.** Связать correlation ID HTTP-запроса с song_id-тегом логов фоновой обработки для сквозной трассировки.

**Нативная аудиоподсистема:**
- [ ] **P3d-20.** `wasapi_monitor_stream.py:98-110` — включить оценку priming-задержки (`2 * blocksize / rate`) в отдаваемые пользователю latency-метрики.
- [ ] **P3d-21.** `recording_service.start_recording()` — останавливать активный standalone-монитор перед открытием отдельного потока записи, либо явно отклонять запуск при конфликте.
- [ ] **P3d-22.** `monitor.cpp`/Python-обвязка — сопоставить частые HRESULT-коды (`AUDCLNT_E_DEVICE_INVALIDATED` и т.п.) с понятными сообщениями вместо сырых кодов.
- [ ] **P3d-23.** `recording_service.py` — добавить watchdog "callback не вызывался N секунд" для обнаружения тихо умершего audio callback потока во время записи.
- [ ] **P3d-24.** `monitor_worker.py` (`_audio_callback`) — заменить `threading.Lock` внутри realtime callback на lock-free замену словаря (паттерн уже применён в `recording_service.py`).
- [ ] **P3d-25.** `backend/engines/asio/bridge_main.cpp` — добавить `AvSetMmThreadCharacteristicsW(L"Pro Audio", ...)` для потоков ASIO-бриджа (уже есть в `monitor.cpp` и `probe_iaudioclient3.cpp`, но не здесь).

**Electron + RGB:**
- [ ] **P3d-26.** `main.cjs` — сохранять/восстанавливать window bounds+display+fullscreen между запусками вместо принудительного fullscreen всегда.
- [ ] **P3d-27.** `main.cjs` — вызвать `Menu.setApplicationMenu(null)` и/или заблокировать DevTools-акселератор в production.
- [ ] **P3d-28.** `main.cjs` (`before-quit`) — дождаться `lighting.close()`/`stopBackend()` через `event.preventDefault()` перед фактическим выходом вместо fire-and-forget.
- [ ] **P3d-29.** `rgb/native/lighting.cpp:49-73` — не терять уже enumerated устройства при таймауте одного конкретного LampArray в цикле опроса.
- [ ] **P3d-30.** `scripts/build-lighting.mjs` — обернуть вызов `vswhere.exe` в try/catch с понятным сообщением, если Visual Studio вообще не установлена.
- [ ] **P3d-31.** `rgb/openrgb.cjs` (`OpenRgb`) — защитить класс от повторного параллельного `request()` (сейчас безопасно только благодаря сериализации со стороны единственного вызывающего кода).
- [ ] **P3d-32.** Добавить `napi_add_env_cleanup_hook` для принудительного релиза LampArray-хендлов при аварийном завершении процесса.

**Frontend React:**
- [ ] **P3d-33.** `front/src/api/core.js:18` — проверить, не режет ли единый 15-секундный таймаут загрузку больших аудиофайлов (`api.addSong`); при необходимости передавать увеличенный `timeoutMs`.
- [ ] **P3d-34.** `karaoke-performance-stage/index.jsx:184`, `Library/songs-grid/song-card.jsx:146` — завести строку "BPM" через систему переводов вместо хардкода.
- [ ] **P3d-35.** `pages/Library/songs-grid/index.jsx` — рассмотреть виртуализацию списка песен для больших библиотек (сотни+ песен).
- [ ] **P3d-36.** `pages/Karaoke/hooks/useKaraokePreferences.js:43-44` — не проглатывать полностью ошибку сохранения настроек на backend (`.catch(()=>{})`), дать пользователю индикацию.
- [ ] **P3d-37.** `pages/MelodyEditor/useEditorController.js` — не перехватывать `Ctrl+A` глобально вне защищённых `HTMLInputElement`/`HTMLSelectElement`/contenteditable-полей.

**Online Room + Cloudflare:**
- [ ] **P3d-38.** `cloudflare/src/worker.js` — добавить монотонный `seq` на уровне Durable Object, транслировать в каждой команде, отбрасывать/переупорядочивать устаревшие.
- [ ] **P3d-39.** `front/src/services/onlineRoom.js:385-391` — расширить очередь реплея после реконнекта на обычные команды `karaoke-player` (play/pause/seek), а не только на `song-ready`/`song-request`.
- [ ] **P3d-40.** По аналогии с host-плейсхолдером ввести облегчённое "guest-reconnecting" состояние в списке участников на время grace-периода.
- [ ] **P3d-41.** Выставить приоритет/лимит полосы для data channel передачи файла относительно голосового трафика в одном WebRTC-соединении.
- [ ] **P3d-42.** Рассмотреть resume передачи файла с прерванного байта (сейчас документированное ограничение — полный рестарт при разрыве, до 512МБ).
- [ ] **P3d-43.** `worker.js:638-643` (`handleLogUpload`) — обернуть `env.LOGS.put` в try/catch с понятным JSON-ответом при переполнении R2-квоты.
- [ ] **P3d-44.** `contexts/OnlineRoomContext.jsx:95` (`voiceError`) — заменить единый слот ошибки на очередь/список, чтобы конкурирующие ошибки не перезаписывали друг друга молча.
- [ ] **P3d-45.** `worker.js:267` — передавать `resumed:true` и для `reclaimedId` (переподключившийся гость), не только для хоста.
- [ ] **P3d-46.** `worker.js:92` (`normalizeRoomId`) — сузить допустимый диапазон валидации `{4,32}` до фактической длины генератора (12/8 символов) как защиту в глубину.
- [ ] **P3d-47.** `onlineVoiceTransfers.js` (`handleLibrarySongFile`) — добавить финальную проверку ревизии после импорта, как уже сделано в `handleKaraokeSongFile`.

**Сборка/релиз:**
- [ ] **P3d-48.** `scripts/karaoke-studio.iss` (`EnsureApplicationExecutable`) — сохранять снапшот старого runtime перед распаковкой нового, чтобы был путь отката при повреждённом локальном архиве.
- [ ] **P3d-49.** `scripts/karaoke-studio.iss` (`GetDefaultDir`) — проверять права записи в выбранный корень диска перед подстановкой по умолчанию.
- [ ] **P3d-50.** `backend/requirements-lock.txt` — сгенерировать hash-lock через `pip-compile --generate-hashes` при следующем плановом обновлении зависимостей.
- [ ] **P3d-51.** `scripts/backend/generate_sbom.py` — переключить генерацию SBOM на уже установленный `cyclonedx-python-lib` вместо ручного `importlib.metadata`.
- [ ] **P3d-52.** `scripts/install-msst-engine.bat` — добавить проверку SHA256 скачанного архива (сейчас только "непустой файл").
- [ ] **P3d-53.** Задокументировать/автоматизировать добавление Windows Defender exclusion для `{app}` (риск ложных срабатываний AV при PyInstaller-фризинге нескольких exe).
- [ ] **P3d-54.** `scripts/generate-size-report.ps1` — добавить soft/hard threshold на общий размер и объём дублей, чтобы раздувание сборки могло проваливать сборку.
- [ ] **P3d-55.** `front/package.json:93` — план миграции ESLint 8 (EOL) → ESLint 9 flat config.
- [ ] **P3d-56.** Выровнять диапазоны версии numpy между `backend/AI/requirements.txt` и `backend/requirements-api.txt`.
- [ ] **P3d-57.** `cloudflare/package.json:13` — перейти на стабильный релиз `miniflare` вместо alpha/nightly dev-зависимости.
- [ ] **P3d-58.** `start-dev.bat` (`stop_dev_processes`) — предупреждать перед принудительным убийством предыдущих dev-процессов, если у них есть активная задача обработки.
- [ ] **P3d-59.** `front/tests/release-e2e/background-diagnostic.spec.mjs:10` — заменить `waitForTimeout(6000)` на `expect.poll`/явное ожидание условия.
- [ ] **P3d-60.** `backend/database.py` — рассмотреть переход на версионированные миграции (Alembic) хотя бы для таблиц с историей поломок (`audio_settings`).

## P3-доп-2 — финальная зачистка (то, что было пропущено в первом проходе)

- [ ] **P3e-1.** `backend/AI/__init__.py` — расширить `__all__` либо создать `AI/api.py`-фасад, реэкспортирующий символы, которые реально используются `app/` (`cache`, `model_registry`, `install_models`, `lyrics_document`, `pitch_post`, `notes`, `runtime`, `utils.*`, `models`, `version`, `audio`) — сейчас граница модуля определяется случайно, а не официальным контрактом.
- [ ] **P3e-2.** `backend/AI/pipeline.py`, `engines/text.py`, `engines/separation.py`, `lyrics_document.py` — заменить `print(..., flush=True)` на структурированный `logging` (сейчас нормальный логгер только в `install_models.py`).
- [ ] **P3e-3.** `backend/AI/service.py` — переименовать один из двух `_lock` (семафор экземпляра `AICoreService._lock` vs модульный `threading.Lock` синглтона), чтобы устранить путаницу имён.
- [ ] **P3e-4.** `backend/app/services/revision_cache.py` — задокументировать явно (docstring/комментарий), что потокобезопасность обеспечивается локами вызывающего кода (`song_content_lock`/`library_write_lock`), а не самим кэшем.
- [ ] **P3e-5.** `backend/app/services/microphone_quality.py` (`MonitorEffectsChain`, `StudioMicrophoneProcessor`) — переиспользовать preallocated-буферы через `out=` параметры numpy вместо новых аллокаций на каждый audio callback (снижает GC-давление на многочасовой сессии).
- [ ] **P3e-6.** `backend/app/services/monitor_control.py` (`_run`) — добавить таймаут-обёртку вокруг `_execute()`, чтобы зависший `action` не блокировал весь командный поток навсегда.
- [ ] **P3e-7.** `front/electron/main.cjs:150-167` — переместить регистрацию `window:setIconTheme`-обработчика после объявления `createWindow()`.
- [ ] **P3e-8.** `front/electron/main.cjs:206` — удалить закомментированный мёртвый код `// mainWindow.maximize();` (или реализовать вместе с P3d-26).
- [ ] **P3e-9.** `front/electron/rgb/controller.cjs:29` — явно инициализировать `this.lastRetry = 0` в конструкторе.
- [ ] **P3e-10.** `cloudflare/src/worker.js:21-27` + `front/src/services/onlineRoom.js:7-9` — добавить unit-тест, сверяющий равенство `ROOM_PROTOCOL_VERSION` между пакетами (по аналогии с прямым импортом `KaraokeRoom` в `room-transport-protocol.test.mjs`).
- [ ] **P3e-11.** `cloudflare/README.md` — явно задокументировать как продуктовое решение: room ID без пароля = полный доступ гостя при знании кода.
- [ ] **P3e-12.** `cloudflare/README.md` — пересмотреть ручной 2-PC чек-лист перед релизом: разделить на "уже покрыто автотестами" (пп. про UI-команды, обрыв/восстановление хоста, close) и "требует ручной проверки" (реальный TURN/NAT, субъективное качество звука).

## P4 — Рефакторинг качества кода (дублирование / мёртвый код / God files)

- [ ] **P4-1.** `backend/AI/engines/text.py` (1157 строк) — вынести number-to-words для RU/UK/EN (строки 23-154) в отдельный `numerals.py`.
- [ ] **P4-2.** `backend/AI/engines/text.py` — свести 4 похожих алгоритма "распределить временное окно между N словами по весу" (`_repair_bounds`, `_context_groups`, части `_ctc_repair`/`align_long_text`, `_repair_collapsed_timed_lines`/`_fill_unresolved_timed_lines`) в одну переиспользуемую утилиту.
- [ ] **P4-3.** Удалить или довести до реализации мёртвый код в `backend/AI/`: `PyinFallbackPitchEstimator`, `CenterChannelFallbackSeparator`, `accelerator_failure`, `fallback_torch_device`, `mark_backend_failed`, `refine_pitch_confidence`, `fuse_pitch_with_yin`, `get_note_diagnostics()`, `build_game_notes`.
- [ ] **P4-4.** `backend/app/services/pipeline_service.py` (1091 строка) — вынести телеметрию/ETA (`_STEP_PLAN`, `_AI_STAGE_PLAN`, `_percent_from_step`, `_runtime_speed_factor`, `_remaining_seconds`, `get_processing_telemetry`) в `pipeline_telemetry.py`. Выделить общий "job runner" каркас для `_run_job`/`_run_symbolic_job` вместо ~140 строк copy-paste.
- [ ] **P4-5.** `backend/app/services/song_package_service.py` (874 строки) — разбить на `song_revision.py` / `song_package_io.py` / `room_import_recovery.py`.
- [ ] **P4-6.** `backend/app/services/kar_dataset_service.py` (1349 строк) — вынести сетевой поиск (YouTube/yt-dlp) в отдельный модуль от чистого MIDI-парсинга; переименовать приватные функции, используемые как общий API с `kfn_dataset_service.py`, в публичные без ведущего подчёркивания.
- [ ] **P4-7.** Удалить мёртвые заглушки `cache_service.recover_optimization_transactions()`/`recover_optimization_state()` (или довести до реализации), `ai_bridge.get_syllables()`, лишний алиас `models_health = pipeline_health` в `diagnostics.py`.
- [ ] **P4-8.** `backend/engines/asio/bridge_main.cpp` vs `backend/app/services/microphone_quality.py` — унифицировать алгоритмы DSP-эффектов (шумоподавление/гейт/компрессор/реверб/эхо/дилей) между ASIO и WASAPI-путём, либо явно задокументировать расхождение как постоянное ограничение.
- [ ] **P4-9.** `front/electron/rgb/openrgb.cjs`/`protocol.cjs` — вынести магические числа команд OpenRGB SDK в именованные константы.
- [ ] **P4-10.** `front/electron/theme-backgrounds.cjs:5-18` — заменить ручной regex-парсинг CSS на нормальный парсер.
- [ ] **P4-11.** Разбить крупные frontend-хуки/компоненты: `pages/Karaoke/index.jsx` (525 строк), `pages/MelodyEditor/useEditorController.js` (464), `pages/Karaoke/hooks/useKaraokeTransport.js` (427), `pages/Library/use-library.js` (379) — на более узкие по домену.
- [ ] **P4-12.** Убрать debug-мусор: `console.log("aaaaaaaaa")` в `front/src/pages/Settings/index.jsx:121`, десятки debug console.log в `Library/animated-backdrop/QuantumFieldBackdrop.jsx`/`qftRuntime.js`.
- [ ] **P4-13.** `front/src/pages/Karaoke/hooks/useKaraokeTransport.js:341` — заменить `useRef(createRoomSyncChannel())` на ленивую инициализацию (`useRef(null)` + создание в эффекте).
- [ ] **P4-14.** `cloudflare/src/worker.js` (658 строк) — разнести `KaraokeRoom` Durable Object и `handleLogUpload`-логику логов на разные модули (`room.js` + `logs.js`). Переписать `webSocketMessage` (if-цепочка на ~207 строк) на handler-map по аналогии с `onlineRoomMessages.js` на фронтенде.
- [ ] **P4-15.** `backend/doc_dump_fixed.txt` — удалить из `backend/` или перенести в архив документации.
- [ ] **P4-16.** `front/package.json` — удалить неиспользуемый `build:electron`+NSIS путь, раз реальный релиз идёт через Inno Setup.

## P5 — Тестовые пробелы (добавить недостающие тесты)

- [ ] **P5-1.** Тест на реальную работу `compute_mode="cpu"` для pitch/ASR/aligner/CTC (не только проверка выставления env-переменной).
- [ ] **P5-2.** Тест на `_write_embedded_audio` без мока на валидном `.kfn` со встроенным аудио (закрывает P0-2 регрессией).
- [ ] **P5-3.** Тест на `_mark_interrupted_jobs` с `CANCELLING` в исходных данных (закрывает P1-1 регрессией).
- [ ] **P5-4.** Тест на конкурентный вызов `_queue_song_job` для одной песни (закрывает P2-4 регрессией).
- [ ] **P5-5.** Тест на исключение внутри `RecordingSession._callback`/`_monitoring_callback` (закрывает P1-3 регрессией).
- [ ] **P5-6.** Тест на steady-state крах дочернего процесса мониторинга (после `started`, не только при старте).
- [ ] **P5-7.** Тест, подтверждающий что событие `{"event":"fallback","cause":"glitches"}` вообще генерируется production-кодом (или удаление мёртвой ASIO4ALL-логики, см. P3-10).
- [ ] **P5-8.** Unit-тест на `isPathInside`/`shell:openSongFolder` из `front/electron/main.cjs` (сейчас не экспортируется, не тестируется).
- [ ] **P5-9.** Тест на сценарий отсутствующего `bpm` в `karaoke-page.test.jsx` (закрывает P2-3 регрессией).
- [ ] **P5-10.** Тест на откат `local`-состояния настроек при ошибке сохранения (закрывает P2-1 регрессией).
- [ ] **P5-11.** Тест, подсчитывающий число вызовов `api.updateUiPreferences`/`updateAudioSettings` при частом drag слайдера/рукоятки (закрывает P2-2 регрессией).

## P6 — Требует динамического тестирования перед закрытием (см. AUDIT.md Часть 5)

- [ ] **P6-1.** Mutation testing — прогнать против существующих unit-тестов, проверить реальную силу покрытия.
- [ ] **P6-2.** Stress test — библиотека из нескольких тысяч песен, десятки участников комнаты одновременно.
- [ ] **P6-3.** Soak test — 8-24ч непрерывной работы с активным мониторингом/подсветкой, отслеживать RAM/handle-утечки (особый фокус — native-аудио, см. AUDIT.md 3.3).
- [ ] **P6-4.** Fault injection в реальном времени — отключение сети/GPU/диска во время активной обработки песни (хелперы уже есть в `backend/tests/fault_injection.py`).
- [ ] **P6-5.** Полный ручной/автоматический проход критического сценария на реальном приложении: импорт → обработка → редактор → караоке → комната → запись.

---

## Как использовать этот файл

Порядок: P0 → P1 → P2 обязательны до релиза (см. AUDIT.md, Release blockers). P3-P4 — после релиза, в порядке приоритета. P5 закрывает тестовые пробелы по каждой найденной проблеме (делать вместе с соответствующим фиксом, не откладывать). P6 — не задача разработки, а прогон, который нужно выполнить перед тем, как считать эти категории аудита закрытыми.

Каждый пункт ссылается на конкретный файл:строку — контекст и обоснование ("почему это проблема") смотреть в [AUDIT.md](AUDIT.md), соответствующая находка помечена тем же файлом.
