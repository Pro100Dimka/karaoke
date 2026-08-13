# A&D Voice — quality and refactoring report

Обновлено: 2026-08-13

## Цель

Довести backend, AI, Electron и frontend до проверяемого промышленного состояния без изменения существующего UI и без изменений в `front/src/theme`.

## Текущий подтверждённый baseline

| Область | Текущее состояние | Цель |
| --- | ---: | ---: |
| Frontend unit tests | 28 тестов | Все feature/domain contracts |
| Frontend statements coverage | 9.55% | 100% учитываемого production-кода |
| Backend/API/AI tests | 510 тестов | Все feature/domain contracts |
| Backend/API/AI coverage | 59% | 100% учитываемого production-кода |
| Mutation testing | 100% для 4 модулей | 100% всей бизнес-логики |
| API/DB integration | 4 сценария | Все API/DB контракты |
| E2E | 1 smoke-сценарий | Все критические пользовательские потоки |

Проценты относятся к фактически измеряемому production-коду. Непокрытые модули не скрываются исключениями ради формального результата.

## Выполнено в текущем цикле

- Frontend unit runner переведён на Vitest с JSX/React coverage.
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
- Backend baseline поднят с 18 тестов / 20% до 510 тестов / 59%; низкий общий процент обусловлен четырьмя крупными пока непокрытыми AI-модулями, которые не исключаются из честного измерения.
- Исправлено чтение ограниченного хвоста лога: обрезанный по байтам фрагмент первой строки больше не выдаётся как полноценная строка.
- Добавлена ранняя проверка некорректных лимитов потоковой загрузки (`limit < 0`, `chunk_size <= 0`).
- Общая команда проверок остаётся зелёной.

## Известные пробелы

- Mutation scope пока ограничен `i18n/runtime`, `i18n/translate`, `language`, `theme`.
- Большинство React-компонентов, hooks и API client ещё не покрыты.
- Значительная часть API routers, pipeline и AI algorithms ещё не покрыта.
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
