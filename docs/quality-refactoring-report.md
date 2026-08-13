# A&D Voice — quality and refactoring report

Обновлено: 2026-08-13

## Цель

Довести backend, AI, Electron и frontend до проверяемого промышленного состояния без изменения существующего UI и без изменений в `front/src/theme`.

## Текущий подтверждённый baseline

| Область | Текущее состояние | Цель |
| --- | ---: | ---: |
| Frontend unit tests | 28 тестов | Все feature/domain contracts |
| Frontend statements coverage | 9.55% | 100% учитываемого production-кода |
| Backend/API/AI tests | 39 тестов | Все feature/domain contracts |
| Backend/API/AI coverage | 21% | 100% учитываемого production-кода |
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
