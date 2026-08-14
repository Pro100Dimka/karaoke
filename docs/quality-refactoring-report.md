# A&D Voice — quality and refactoring report

Обновлено: 2026-08-14

## Цель

Довести backend, AI, Electron и frontend до проверяемого промышленного состояния без изменения существующего UI и без изменений в `front/src/theme`.

## Текущий подтверждённый baseline

| Область | Текущее состояние | Цель |
| --- | ---: | ---: |
| Frontend unit tests | 463 теста (54 файла) | Все feature/domain contracts |
| Frontend coverage | 100% statements / 100% branches / 100% functions / 100% lines | Поддерживать 100% учитываемого production-кода |
| Backend/API/AI tests | 716 тестов | Все feature/domain contracts |
| Backend/API/AI coverage | 100% (11 356 statements, 0 missed) | Поддерживать 100% учитываемого production-кода |
| Mutation testing | Полный baseline: 59.81% из 9 212; подтверждённые shards: 3 001/3 001 (100%) | 100% всей бизнес-логики |
| API/DB integration | 4 сценария | Все API/DB контракты |
| E2E | 6 сценариев | Все критические пользовательские потоки |

Проценты относятся к фактически измеряемому production-коду. Непокрытые модули не скрываются исключениями ради формального результата.

## Выполнено в текущем цикле

- Frontend unit runner переведён на Vitest с JSX/React coverage.
- REST transport, все API domains и mock API закрыты контрактными тестами. Исправлена нормализация массивов HTTP-заголовков: ранее `Array.entries()` ошибочно превращал имена заголовков в числовые индексы.
- Mutation-runner поддерживает быстрые изолированные шарды, отдельные JSON-отчёты, выбор тестовых файлов, настраиваемую конкуренцию и видимый прогресс. API transport, normalizers и семь API domains подтверждены на 478/478 мутантах; время повторного API-прогона сокращено с десятков секунд на каждый файл до 5–11 секунд на шард.
- Общие utilities и базовая karaoke/library/online-room/settings-логика подтверждены отдельными mutation-отчётами: API, runtime config, storage/errors, audio/UI preferences, clipboard, hardware performance profile, hotkeys/language/theme, audio settings source/catalog/factories, diagnostics/history/memory screen configs и helpers, display/format/layout/panorama/result, melody guide, note normalization, karaoke controls/hotkeys/result/stage layout, preferences/transport/timeline, analysis, devices, lyrics, melody, pitch, karaoke data, library filtering/processing state, file import, song actions и room sync, online-room actions, navigation/name gate, diagnostics polling, message synchronization и WebSocket transport, mounted/latest refs, async queue, exclusive action, polling, console presets, memory formatting, dialog contracts, settings-form normalization/state/navigation, application settings, song settings и song-card actions. Совокупно проверено 4 325 mutants: 4 314 killed и 11 loop/async-mutants обнаружены timeout; survived/no-coverage/error отсутствуют, mutation score — 100%. Доказанно эквивалентные lifecycle/dependency/fallback mutations помечены ignored с локальным объяснением.
- Добавлены поведенческие jsdom-тесты UI primitives, полей, таблиц, AudioPlayer и базовых async/karaoke hooks. Исправлен контракт `useExclusiveAsyncAction`: параллельные вызовы теперь действительно получают один и тот же Promise, как обещает публичный API hook.
- Контракты комнат покрывают обновление участников, signaling, синхронизацию UI/эффектов, запрос/передачу пакета песни, ошибки передачи и intentional disconnect. Покрытие `onlineRoomMessages` поднято до 94.25% statements / 98.66% lines.
- Добавлен общий V8 coverage всего frontend вне `src/theme` и статических assets.
- Добавлены регрессии чистой karaoke/library/editor бизнес-логики.
- Добавлены настоящие FastAPI + SQLAlchemy integration-тесты.
- Backend coverage включён в единую команду `scripts/check.bat`.
- Mutation gate остаётся строгим: `break: 100`.
- Добавлены JS/React и Python AST-аудиты смысловой плотности.
- Добавлено 12 unit-тестов файловой инфраструктуры; `atomic_files`, `files`, `json_files`, `json_values`, `quarantine` и `uploads` имеют 100% покрытия строк в полном backend-прогоне.
- Транзакционные helpers, DB repositories, удаление записей вместе с файлами и состояние karaoke-плеера закрыты ещё 9 тестами и имеют 100% покрытия строк.
- Проверено восстановление файлов при неуспешном commit, best-effort очистка карантина и гонка параллельного создания playback state.
- ORM-модели, Pydantic-схемы и FastAPI entity dependencies имеют 100% покрытия строк; проверены нормализация текста, MIDI-диапазоны, тайминги слов и стабильные 404-контракты.
- `config.py` и `database.py` имеют 100% покрытия строк; проверены portable/frozen пути, env-границы, поиск runtime executable, AI resource environment и SQLite recovery/migrations.
- `app_settings_service.py` имеет 100% покрытия строк: legacy compute-настройки, installer preferences, storage paths и все UI preference namespaces проверяются вместе с recovery повреждённых файлов.
- `model_install_service.py` имеет 100% покрытия строк: recovery-download, прогресс/ETA, idempotent retry, проверка ресурсов и переходы missing/downloading/error/ready.
- Audio device/driver selection покрывает WASAPI, ASIO, системный fallback, соответствие input/output одному host API и повтор запуска после ошибки WDM; `audio_service` поднят с 23% до 47%.
- Recording contracts покрывают fallback capture modes, управление сессиями, confinement путей, безопасное удаление, эффекты и FFmpeg mix; `recording_service` поднят с 24% до 50%.
- Удалена недостижимая ветка проверки ASIO output после безусловного выхода из ASIO-пути.
- `audio_service.py` и `recording_service.py` доведены до 100% покрытия строк: процессы мониторинга, таймауты, rollback, WDM fallback, callbacks, writer thread, atomic WAV publish и cleanup проверены.
- `storage_migration.py` и `cache_service.py` доведены до 100% покрытия строк: legacy moves, interrupted migration recovery, cleanup, lossless stem compression и сохранение исходников при сбое ffmpeg проверены.
- `analysis_service.py` доведён до 100% покрытия строк: MIDI parsing, half-open note ranges, фильтрация некорректных pitch frames и секционные метрики проверены.
- `diagnostics_service.py` доведён до 100% покрытия строк: component discovery, health degradation, versions и сериализация последних ошибок проверены.
- `monitor_worker.py`, `app.main` и routers application/cache/diagnostics/player доведены до 100% покрытия строк, включая subprocess fallback и lifespan cleanup.
- Routers audio/analysis/recording доведены до 100% покрытия строк: HTTP error mapping, session lifecycle, ASIO transient monitoring, file fallback и analysis insert races проверены.
- `song_service.py` доведён до 100% покрытия строк: metadata identity, safe paths, slug/folder collisions, streaming moves, rollback и transactional deletion проверены.
- `song_package_service.py` доведён до 100% покрытия строк: zip-slip/symlink/encryption/zip-bomb protection, atomic import, concurrent identity recheck и cleanup проверены.
- `song_editor_service.py` и songs router доведены до 100% покрытия строк: merged syllable timing, backup/reset, upload/import/export, queue compensation, tracks/logs/result и trusted lyrics проверены.
- `pipeline_service.py` доведён до 100% покрытия строк: runtime device/threads, weighted ETA, heartbeat, cancellation, job cleanup, overrides, reprocess invalidation и worker failure boundaries проверены.
- `ai_bridge.py` доведён до 100% покрытия строк: запуск AI Core, преобразование pitch, согласование слов, построение строк и timeline, восстановление невозможных интервалов и legacy-артефакты проверены; удалена недостижимая ветка выбора вокального региона.
- Инфраструктурные модули AI `artifacts`, `config`, `device`, `registry`, `models`, `profiler`, `quality`, `service` и `utils/io` доведены до 100% покрытия; проверены rollback атомарной публикации, CPU/CUDA-конфигурация, singleton/reset AI-сервиса и ошибочные доменные значения.
- `AI/audio.py` и `AI/validators.py` доведены до 100% покрытия: FFmpeg timeout/error/invalid output, ресемплинг, повреждённые audio/JSON/timeline/pitch/music артефакты проверены; неизвестный derivation-kind теперь возвращает единый `InvalidArtifactError`, а не необработанный `KeyError`.
- `AI/midi.py`, `AI/karaoke_timeline.py` и `AI/syllables.py` доведены до 100% покрытия. Исправлены float-погрешность порога объединения display-notes, падение на повреждённом индексе слога и ложная акустическая граница с нулевым evidence-score; повторяющиеся преобразования индексов сжаты в один безопасный helper, удалены недостижимые ветви.
- `AI/cache.py` доведён до 100% покрытия: versioned index, content hash memoization, межпроцессная commit/invalidate-транзакция, изменение и повреждение артефактов, validator/filesystem failures проверены.
- `AI/music.py` доведён до 100% покрытия: adaptive harmonic windows, key evidence, coarse/fine/octave tempo selection, beat regularity и безопасный fallback проверены; удалены две математически недостижимые ветви оконного анализа.
- `AI/diagnostic_audio.py` и `AI/locks.py` доведены до 100% покрытия: authoritative stereo ear-check, очистка временных WAV/MP3, stale/PID-reuse lock recovery, Windows/POSIX process identity, timeout и thread/process lock cleanup проверены.
- `AI/engines/pitch.py` и `AI/engines/separation.py` доведены до 100% покрытия: FCPE bundled-model loading и legacy API, clipped/quiet/unvoiced frames, pYIN fallback, packaged MSST namespace isolation, null stdout/stderr, heartbeat/timeout/child failure, missing/mismatched stems и center-channel fallback проверены. Полный suite также проверяет отсутствие утечки временного `models` namespace между задачами.
- `AI/vocal_preprocess.py` доведён до 100% покрытия: time-preserving FFmpeg variants, adaptive tail gate, ghost-note pitch quality, cleaned-track dominance и signal-only echo/reverb/leakage/noise/clipping proxies проверены. Исправлено падение median-hop на одинаковых timestamps, пустой RMS теперь не создаёт `NaN`, корреляция огибающих вычисляется без предупреждений на постоянном сигнале.
- `AI/diagnostics.py` доведён до 100% покрытия: CTC/Qwen/consensus/interpolated sources, vocal overlap, suspicious regions, pitch postprocess delta, effect impact, timeline integrity, game-note/syllable quantiles и root-cause ranking проверены. Диагностика теперь доказанно переносит метрики остаточного echo/reverb/leakage до итогового отчёта песни.
- `AI/alignment_debug.py`, `AI/pitch_post.py` и `AI/install_models.py` доведены до 100% покрытия: первая точка lyric drift, waveform confidence, FCPE/YIN phrase decode, harmonic stabilization, resumable progress/ETA, shard/checksum verification, retries/pruning и environment publication проверены. Удалены недостижимые RMS/Viterbi/PitchFrame-guard ветви.
- `AI/pipeline.py` доведён до 100% покрытия: fresh/cached анализ, trusted/ASR lyrics, long-text anchors, timed segments, diagnostic fallback, изменение исходника во время decode, некорректный BPM и неполный manifest проверены. Удалены две математически недостижимые ветви локального восстановления timeline.
- `AI/lyrics_sources.py` и `AI/engines/ctc_alignment.py` доведены до 100% покрытия: sidecar/embedded lyrics, LRCLIB/web matching, LRC bounds, HTML/charset safety, packaged model discovery, CTC Viterbi, tokenizer failures, CPU/CUDA inference и anchor retry проверены. Исправлен parser-depth на HTML `<br>`, ранее мёртвые локальные источники подключены к discovery, удалены недостижимые CTC-состояния и неиспользуемые вычисления.
- `AI/notes.py` доведён до 100% покрытия: vibrato/glissando guards, устойчивые pitch-state transitions, energy re-attacks, lyric phrase masking, monophonic repair, YIN/spectral register verification, harmonic/octave proposal acceptance/rejection и syllable-granular game notes проверены. Удалены доказанно недостижимые ветви short-tail merge и invalid proportional boundary.
- Backend baseline поднят с 18 тестов / 20% до 716 тестов / 100%: полный согласованный scope `AI` + `app` содержит 11 356 исполняемых statements и 0 пропусков.
- `AI/engines/text.py` доведён до 100% (2 603 statements, 0 missed; 116 профильных тестов). Удалены дублирующие и математически недостижимые fallback-пути, исправлены невалидные интервалы внешних меток, отрицательный rebase контекстного Qwen-кандидата, потеря причин отклонения в диагностике и падение при невозможном размещении текста в слишком коротком аудио.
- Исправлено чтение ограниченного хвоста лога: обрезанный по байтам фрагмент первой строки больше не выдаётся как полноценная строка.
- Добавлена ранняя проверка некорректных лимитов потоковой загрузки (`limit < 0`, `chunk_size <= 0`).
- Общая команда проверок остаётся зелёной.
- Центральная karaoke-консоль доведена до 100% unit coverage по statements, branches, functions и lines.
- Основной редактор мелодии доведён до 100% lines/functions; тесты проверяют историю, clipboard, hotkeys, ноты, marquee, playhead, прокрутку, media clock, synth и recovery. Устранён перехват `Space` из полей ввода и списков редактора.
- I18n provider доведён до 100% unit coverage, включая fallback на украинский язык и защиту hook вне provider.
- Главная karaoke-страница доведена до 100% lines/functions: проверены intro/blackout, auto-start и его recovery, pause/resume/stop, radio handoff, media-ended, анализ исполнения, monitoring и все console mutations.
- Удалён недостижимый microphone modal. Его вечный `microphoneOpen=false` блокировал polling уровня микрофона и ASIO/output routing; теперь сигнал и маршрутизация активны в karaoke-сессии без визуального изменения UI.
- Library доведена до 100% lines/functions: проверены terminal/404 processing recovery, ошибки комнат, отмена и ошибки destructive actions, recordings/analysis callbacks и настройки песни.
- `onlineVoiceMesh` доведён до 100% functions: добавлены проверки stale peers, disconnect expiry, signal queue recovery, transfer stall/timeout, channel cleanup и остановки локального stream.
- Settings config и композиционные providers/hero/console доведены до 100% unit coverage; упрощён лишний динамический рендер hero без изменения DOM-порядка.
- Закрыты дополнительные конкурентные и граничные сценарии polling, комнат, аудиомаршрутизации, pitch detection, числовых полей, склейки слогов, mock API, modal focus, анализа исполнения и поздних room/song ответов. Удалены недостижимые дубли проверок короткого room code, lyric-time source и пустой optimize target; frontend baseline подтверждён на 386 тестах.
- Frontend production scope впервые доведён до 100% statements, functions и lines: 401 тест, 6 862 statements без пропусков. `onlineVoiceMesh` и редактор мелодии имеют 100% statements/lines/functions; устранена гонка двойного открытия karaoke из Library. Следующий активный gate — оставшиеся branch-контракты (90.53% подтверждено).

## Известные пробелы

- Полный mutation baseline измеряет 99 production-файлов: 5 504 killed, 3 669 survived, 5 no-coverage, 21 timeout, 4 runtime-error и 9 ignored из 9 212 мутантов. После API-шардов основная работа остаётся в i18n, online voice mesh, radio, online room, Settings и karaoke/editor hooks.
- Unit coverage крупных React-потоков подтверждено на 100% по всем четырём метрикам, но их mutation-контракты ещё не доведены до 100%.
- Нет полного Electron IPC contract suite и packaged Electron smoke test.
- E2E пока не проверяет импорт, обработку, редактор, караоке, комнаты и recovery моделей.
- Complexity/size/semantic-density отчёты пока advisory, а не blocking gates.

## Обязательная последовательность

1. Unit coverage frontend/backend/AI.
2. Mutation coverage бизнес-логики.
3. API/DB/IPC/room/AI integration и contract tests.
4. Critical-flow E2E и Electron smoke.
5. Строгие quality gates и CI.
6. JS/React Semantic Simplification.
7. Pythonic Semantic Compression.
8. Финальный senior refactoring архитектуры.
9. Полный контрольный прогон без ISO.

## Ограничения

- UI должен визуально и функционально сохраняться, кроме отдельно заказанных изменений.
- `front/src/theme` не изменяется.
- ISO и installer не запускаются без прямого запроса пользователя.
- 100% объявляется только после измерения полного согласованного scope, а не выбранной подгруппы файлов.
