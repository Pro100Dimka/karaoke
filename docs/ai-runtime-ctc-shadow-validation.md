# A&D Voice — BackendRegistry и CTC shadow corpus validation

Дата: 2026-08-14

## Решение

**ORT CUDA FP16 для RU/UK CTC нельзя включать в production.** На изолированных
входах он был быстрее на 22–24%, однако corpus gate выявил редкие изменения
argmax, которые из-за последовательного cursor-based alignment каскадно меняют
следующие окна. В полном pipeline изменились `lyricsSync`, `syllables`,
`acousticNotes`, `reference`, оба MIDI, `songMap`, quality и diagnostics.

Production остаётся текущий PyTorch. ORT доступен только в выключенном по
умолчанию shadow mode; ошибка, отсутствие DLL/артефакта или CUDA EP не меняют
пользовательский результат. RoFormer, Qwen, FCPE, tempo и UI не менялись.

## BackendRegistry

`BackendRegistry` отделяет описание возможности от выбора end-to-end плана.
Для каждой записи хранятся:

- model, backend, device, precision и priority;
- ленивый availability probe и причина недоступности;
- RAM/VRAM requirements;
- artifact requirements;
- capabilities и dynamic supported shapes;
- quality status и benchmark status;
- упорядоченный fallback.

Текущая цепочка для `ctc_ru` и `ctc_uk`:

```text
ORT CUDA FP16 (shadow-only, corpus-quality-rejected)
        ↓
PyTorch CUDA FP16 (production baseline)
        ↓
PyTorch CPU FP32 (universal fallback)
```

Адаптеры:

1. `PyTorchCTCBackend` — точная оболочка текущего production inference.
2. `OrtCudaCTCBackend` — ленивый optional runtime, dynamic waveform input,
   session/cache lifecycle и явный запрет скрытого ORT fallback на CPU.
3. `ShadowPolicy` — deterministic song-level sampling и resident/unload policy.

Registry не импортирует ORT при старте. ONNX path задаётся отдельно для RU/UK.
Shadow сравнивает одинаковый нормализованный waveform, но всегда возвращает
production PyTorch logits. Любая shadow-ошибка превращается только в diagnostic.

## Corpus

Проверено восемь случаев: RU/UK, мужской/женский/хоровой вокал, короткие и
длинные записи, быстрый и медленный текст, повторяющиеся припевы, сильное echo,
слабый вокал, instrumental bleed, WAV/FLAC/OGG, 22.05/44.1/48 kHz.

Реальные открытые записи:

- [Lysenko, «Ой крикнули сірії гуси»](https://commons.wikimedia.org/wiki/File:Lysenko-Oj_kryknuly_siri_husy.ogg), CC BY-SA 3.0;
- [«Щедрик» (1969)](https://commons.wikimedia.org/wiki/File:%D0%A9%D0%B5%D0%B4%D1%80%D0%B8%D0%BA_(%D0%9A%D1%80%D0%B5%D1%87%D0%BA%D0%BE,_1969).ogg), CC BY 4.0;
- [Шаляпин, «Эй, ухнем!»](https://commons.wikimedia.org/wiki/File:%D0%AD%D0%B9,_%D1%83%D1%85%D0%BD%D0%B5%D0%BC!_-_%D0%A4%D1%91%D0%B4%D0%BE%D1%80_%D0%A8%D0%B0%D0%BB%D1%8F%D0%BF%D0%B8%D0%BD.ogg), public domain.

Плюс использована реальная текущая песня проекта и детерминированные stress
variants. Generated/downloaded audio остаётся только в ignored `build/`.

## Raw CTC corpus result

| Язык | Cases | Frames | Changed argmax | Agreement | Shadow failures |
|---|---:|---:|---:|---:|---:|
| RU | 6 | 45,480 | 44 | 99.90325% | 0 |
| UK | 2 | 12,265 | 6 | 99.95108% | 0 |
| Итого | 8 | 57,745 | 50 | 99.91341% | 0 |

| Case | Agreement | Line result | Timing MAE | P95 | Max |
|---|---:|---|---:|---:|---:|
| RU project | 99.90657% | 4/4 = 4/4 | 0.071 ms | 0 | 20.006 ms |
| RU strong echo | 99.88322% | 4/4 = 4/4 | 0 | 0 | 0 |
| RU weak vocal | 99.92993% | 4/4 = 4/4 | 7.145 ms | 0 | 1,220.382 ms |
| RU 22.05 kHz FLAC | 99.87154% | 4/4 = 4/4 | 16.934 ms | 0 | 1,080.338 ms |
| RU instrumental bleed | 99.90465% | 4/4 = 4/4 | 15.372 ms | 160.233 ms | 440.091 ms |
| RU Shalyapin | 99.96476% | 13/13 = 13/13 | **929.201 ms** | **2,181.805 ms** | **3,214.093 ms** |
| UK Lysenko | 99.98816% | **19/19 ≠ 9/19** | **401.132 ms** | **2,798.849 ms** | **3,857.551 ms** |
| UK Shchedryk | 99.86897% | 14/14 = 14/14 | 0 | 0 | 0 |

Ключевой вывод: даже одна изменённая frame boundary может изменить принятый
line span. Новый end cursor меняет следующее search window, поэтому ошибка
каскадирует. Именно это произошло в UK Lysenko; 99.98816% raw agreement не
гарантирует одинаковый karaoke timing.

## Reconciliation и downstream

Полный `Qwen3ForcedAligner.align_long_text` дополнительно проверен на трёх
наиболее показательных случаях.

| Case | Canonical text | Timing MAE | P95 | Max | Merge mode |
|---|---|---:|---:|---:|---|
| RU project | 198/198 equal | 121.45 ms | 110.08 ms | 6,184.28 ms | partial-anchors-v2 |
| UK Lysenko | 117/117 equal | 0.43 ms | 0 | 100.10 ms | partial-anchors-strict |
| RU Shalyapin | 40/40 equal | 636.99 ms | 3,430.41 ms | 5,132.49 ms | line-aware |

Reconciliation иногда маскирует raw divergence (UK Lysenko), но не делает это
гарантированно. Текст сохраняется lossless, а timings — нет.

Контрфактический полный RU pipeline на одинаковых cached upstream artifacts:

- canonical text: 198/198 equal;
- timing MAE 93.598 ms, P95 160.105 ms, max 3,302.294 ms;
- все десять проверенных serialized downstream artifacts имеют разные SHA-256;
- значит quality gate для karaoke результата не пройден.

## Performance

Изолированный long-input baseline остаётся наиболее чистым сравнением network
stage:

| Model | PyTorch CUDA | ORT CUDA FP16 | Warm speedup | Peak RAM | Peak VRAM |
|---|---:|---:|---:|---:|---:|
| RU CTC | 0.1115 s | 0.0843 s | 24.39% | 1.91 → 1.52 GiB | 3.37 → 2.05 GiB |
| UK CTC | 0.1105 s | 0.0853 s | 22.74% | 1.90 → 1.52 GiB | 3.36 → 2.07 GiB |

Corpus wall totals (первый production pass включает cold model/cache effects,
поэтому это не чистый speedup): RU 58.45 → 28.48 s, UK 19.32 → 5.41 s.

Full cached-upstream counterfactual:

| Metric | PyTorch | ORT counterfactual | Delta |
|---|---:|---:|---:|
| CTC inference, 10 windows | 0.970 s | 1.401 s | ORT +44.4% |
| ORT session init | — | 10.804 s | cold cost |
| Alignment | 6.215 s | 15.552 s | ORT +150.2% cold |
| Pipeline wall | 94.401 s | 32.579 s | not comparable |
| Peak RSS | 5,000 MiB | 5,765 MiB | +765 MiB |
| Peak CUDA allocated | 4,481.8 MiB | 4,490.2 MiB | +8.4 MiB |

Pipeline wall нельзя трактовать как ORT speedup: PyTorch run попал на 69.2 s
cold Qwen load, а повторный run — на 2.9 s warm load. Если только арифметически
убрать 10.804 s session init, candidate alignment был бы около 4.75 s, но такой
projection не является production benchmark и не отменяет quality failure.

Resident session сокращает cold cost между песнями, но на RTX 3060 8 GiB при
совместном проживании с Qwen появились cuDNN frontend `HEURISTIC_QUERY_FAILED`.
ORT wrapper попытался молча выполнить весь session на CPU. Адаптер теперь
запрещает этот скрытый fallback; ошибка shadow не влияет на production.
Рекомендуемая policy для 8 GiB — выгружать ORT перед Qwen. Resident допустим
только после memory-budget gate на GPU с большим VRAM.

## Artifacts и installer impact

| Payload | Bytes | Approx. MiB |
|---|---:|---:|
| RU FP16 ONNX | 631,563,228 | 602.3 |
| UK FP16 ONNX | 631,565,278 | 602.3 |
| Оба ONNX | 1,263,128,506 | 1,204.6 |
| Текущие RU+UK weights | 2,524,065,151 | 2,407.1 |
| Исследовательский ORT package | 362,953,947 | 346.1 |
| ORT CUDA provider DLL | 321,484,320 | 306.6 |
| ORT core + Python binding | 32,958,064 | 31.4 |

PyTorch 2.8+cu126 и ORT 1.22 используют CUDA 12/cuDNN 9. Локальный benchmark
успешно переиспользовал PyTorch CUDA/cuDNN DLL через preload, поэтому второй
полный CUDA pack не нужен. Но ORT provider/core всё равно добавляет примерно
346 MiB. Research directory не является production requirements.

Сейчас shipping обоих ONNX рядом с canonical PyTorch weights увеличил бы payload
примерно на **1.626 GB**, поэтому ONNX нельзя добавлять в installer. Удалить
PyTorch weights тоже нельзя: ORT не прошёл quality gate, а PyTorch/CUDA всё ещё
нужны RoFormer/Qwen/другим стадиям. Canonical artifact остаётся PyTorch snapshot.

Если будущая версия пройдёт corpus gate, ONNX следует экспортировать build-time,
проверять ONNX checker + corpus quality hashes и класть в model-download manifest,
а не генерировать на ПК пользователя. Provider caches создаются на пользовательском
ПК по hardware/runtime fingerprint.

## Tempo: точный STFT/HPSS breakdown

Read-only профиль текущего алгоритма, песня 145.117 s, результат неизменён:
BPM 144 / raw 143.555 / D# major.

| Внутренняя операция | Calls | Time |
|---|---:|---:|
| STFT | 1 | 0.1122 s |
| HPSS median filtering/masks | 1 | **4.2527 s** |
| ISTFT harmonic + percussive | 2 | 0.2674 s |
| Onset strength (hop 512 + 256) | 2 | 0.2425 s |
| Beat tracking (hop 512 + 256) | 2 | 0.4304 s |
| Chroma CQT | 1 | 0.5380 s |
| Full stage | — | 6.2873 s |

HPSS использует `n_fft=2048`, Hann, default `hop_length=512`, centered STFT.
Спектрограмма имеет shape `[1025, 6250]`. Она вычисляется один раз для HPSS,
затем создаются две masked спектрограммы и выполняются два ISTFT. Главный
bottleneck — не FFT, а median filtering/mask decomposition (4.25 s).

Повторного identical STFT внутри `analyze_music` нет. Tempo намеренно считает
две разные onset grids (512 и 256); chroma CQT строит собственное представление
из harmonic waveform. Exact-equivalent reuse возможно только если хранить HPSS
STFT/masks и добавить spectrogram-native downstream, но текущие librosa APIs
принимают waveform и такое изменение уже требует математического regression
proof. Простого безопасного кэша, который даст 4.25 s без изменения алгоритма,
не найдено. Межстадийный reuse также пока невозможен: другие pipeline stages
работают с другим source/sample-rate/window semantics.

## Итоговая рекомендация

1. Оставить PyTorch CUDA production и PyTorch CPU fallback.
2. Оставить ORT CTC только как выключенный shadow/research adapter; registry
   status — `disabled/corpus`.
3. Не добавлять ONNX/ORT в production installer.
4. Следующим сделать **FCPE shadow corpus gate**: его isolated quality margin был
   сильнее, artifact всего 20.7 MiB, а риск installer ниже.
5. Для CTC перед новым gate исследовать FP32 ORT либо selective/mixed FP16 и
   устойчивый alignment cursor; принимать только по полному downstream corpus.
6. Tempo не менять до отдельного согласования; потенциальная оптимизация должна
   атаковать HPSS filtering, а не WAV decode/STFT.

## Reproduction

- `scripts/ai_runtime_benchmark/ctc_shadow_corpus.py`
- `scripts/ai_runtime_benchmark/ctc_pipeline_compare.py`
- `scripts/ai_runtime_benchmark/profile_tempo_detailed.py`
- ignored results: `build/ctc-shadow-corpus/`,
  `build/ctc-pipeline-compare-run4/result.json`,
  `build/ai-runtime-benchmark/tempo-profile-detailed.json`
