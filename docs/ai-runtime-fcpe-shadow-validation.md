# FCPE shadow validation and bounded follow-up

Date: 2026-08-14. Production remains the existing PyTorch pipeline. ONNX Runtime is research-only, disabled in the registry, and is not an installer dependency.

## Decision

ORT CUDA FP16 is **not accepted for FCPE production**. The neural core is faster, but the complete warm pitch stage is not faster and the downstream artifacts are not equivalent. Per the staged stop rule, no additional FCPE precision/backend matrix was run.

## FCPE corpus gate

The corpus contains 13 cases and 189,605 frames: RU/UK/EN recordings plus weak vocal, echo/reverb, instrumental bleed, male/female, choir/fast text, repeated phrases, high/low register, vibrato and rasp stress cases.

| Metric | Raw FCPE | After existing stabilizer |
|---|---:|---:|
| False-positive voiced frames | 16 | 4 |
| False-negative voiced frames | 8 | 1 |
| Worst voiced agreement | 99.9331% | 99.9890% |
| Worst voiced F1 | 99.9625% | 99.9939% |
| Weighted cents MAE | 0.4354 | 0.2730 |
| Worst case P95 cents | 0.1019 | 0.0877 |
| Absolute maximum cents error | 2407.86 | 1624.36 |

The common case is numerically very close, but rare voiced decisions and octave-scale outliers remain. The stabilizer reduces rather than removes them.

## Performance and downstream gate

For the 13-case neural-core corpus, the resident ORT session initialized in 4.500 s and its inference total was 1.002 s. The PyTorch full estimator total was 7.166 s, but those totals do not represent equivalent stage boundaries.

The controlled pipeline comparison is decisive:

| Metric | PyTorch | ORT CUDA FP16 | Difference |
|---|---:|---:|---:|
| Cold wall | 9.625 s | 12.526 s | ORT 30.1% slower |
| Cold pitch stage | 1.555 s | 6.443 s | session initialization dominates |
| Warm pitch stage | 0.934 s | 0.945 s | ORT 1.2% slower |
| Warm neural inference, 3 calls | 0.382 s | 0.189 s | ORT core 50.5% faster |
| Warm wall | 7.662 s | 7.089 s | not a valid speedup claim because downstream work changed |

Clean isolated Stage-4 measurements also showed higher resource use for ORT FCPE: approximately 1.69 GiB peak RAM / 1.80 GiB peak VRAM versus 1.21 GiB / 1.40 GiB for PyTorch. In the shared-process pipeline run, CUDA accounting cannot see ORT allocations, so it is not used for a VRAM conclusion.

Every checked user artifact hash changed: `pitch`, `syllables`, `reference`, `melodyContour`, `acousticNotes`, `vocal.mid`, `game.mid`, `songMap`, and `quality`. Structured comparison found:

- pitch frame count stayed 14,512, but maximum frequency drift reached 392.91 cents;
- acoustic notes changed 364 → 365, with 6 production and 7 candidate notes unmatched;
- reference notes changed 692 → 688, with 12 production and 8 candidate notes unmatched;
- matched acoustic-note edges differed by as much as 110 ms;
- matched reference edges differed by as much as 198.18 ms.

This fails the performance-preserving quality gate. The apparent 7.5% warm wall reduction is invalid because the candidate produced different downstream work.

Resident policy: residency is mandatory for any future shadow sampling because a 4.5–4.8 s session creation per pitch pass is prohibitive. A future memory manager should retain the session across the three pitch variants, then evict it before large separation/ASR models when the VRAM budget requires it. It should not be shipped now.

## CTC bounded follow-up

FP32 ORT was completed on the same eight-case, 57,745-frame CTC corpus. It still differed on 20 frames (99.9654% argmax agreement), versus 50 frames for FP16 (99.9134%). FP32 therefore reduces but does not eliminate runtime/model numerical differences. It also still produced timing differences up to 3.214 s in the sequential aligner and fails the downstream equivalence gate. Its candidate alignment total was 126.713 s versus 176.864 s for the paired PyTorch run, but it is not production-eligible.

The first mixed-precision profile kept LayerNorm and ReduceL2 in FP32. Artifact conversion completed, but the cheap ORT load smoke test failed before inference: a positional-convolution `Div` received mixed `float` and `float16` inputs. No other profiles were tried.

The CTC divergence amplification is sequential, not evidence of thousands of independently wrong logits. `align_lines` advances a mutable cursor from the previous accepted word end. A small boundary difference changes the next waveform window and convolution frame grid; a usable-threshold decision can then drop/retry a line from a different cursor, magnifying a one-frame disagreement into a large timestamp shift. Safe future quality work would make the window/anchor schedule independent of candidate output or use a global monotonic reconciliation, but that is an algorithm change and was not made here.

## HPSS feasibility

One 145.117 s representative song produced a 1025 × 6250 float32 magnitude spectrogram (24.44 MiB), using `n_fft=2048`, `hop_length=512`, median kernel 31 and reflect boundaries.

| Candidate | Two median filters | Exact to current output | Decision |
|---|---:|---:|---|
| Current SciPy `ndimage.median_filter` | 3.831 s | baseline | keep |
| SciPy `signal.medfilt2d` with symmetric padding | 3.491 s | yes | only ~8.9%; not worth changing now |
| SciPy `rank_filter` | 3.820 s | same rank/boundary contract | no benefit |
| Chunked PyTorch CUDA median | 1.419 s | yes on this input | promising 63%; NVIDIA-only and requires a future cross-hardware gate |

STFT itself took only 0.047 s in this feasibility run; median filtering remains the bottleneck. CuPy was not installed because it adds another NVIDIA-specific runtime, and OpenCV's square-kernel/type contract does not match the required separable 1×31 / 31×1 float32 operation. No tempo/HPSS production code changed.

## Foundation status

`BackendRegistry` now carries model, backend, device, precision, availability, priority, RAM/VRAM requirements, artifacts, capabilities, shapes, quality/benchmark status, fallbacks, vendor and optional runtime requirements. CUDA entries explicitly declare NVIDIA; CPU fallbacks declare `any`. The contract can register DirectML, OpenVINO, Intel or CPU adapters without changing model pipelines.

This is a vendor-neutral registry foundation, not yet a hardware planner. Hardware/runtime fingerprinting, measured plan selection and shared memory-budget enforcement remain future work. ORT is one optional shared runtime family across FCPE/CTC, but model artifacts remain separate; since both current FP16 candidates failed quality, shipping approximately 346 MiB of ORT GPU runtime plus the ONNX files has no present value. Installer and production requirements remain unchanged.

## Verification and evidence

- Focused backend/shadow tests: 48 passed.
- Production result still comes exclusively from PyTorch; all shadow failures are isolated.
- Source corpus, hashes, per-case telemetry and raw comparisons are stored under ignored `build/fcpe-shadow-corpus/`.
- HPSS measurements are stored under ignored `build/ai-runtime-benchmark/hpss-feasibility.json`.
- No UI, theme, installer, RoFormer, Qwen, tempo algorithm or production backend was changed.

## Highest-value next choices

1. Implement hardware/runtime fingerprinting plus memory budgets on top of the registry; this survives future model changes and enables NVIDIA/AMD/Intel/CPU policy safely.
2. Generalize quality-gate/benchmark fixtures so future improved melody/alignment algorithms are evaluated against objective corpus labels, while exact baselines remain only for performance-preserving work.
3. Only if tempo remains a user-visible bottleneck after higher-priority quality work, validate the exact PyTorch CUDA HPSS median on a small AMD/Intel/CPU-aware policy and several songs before any production integration.
