# A&D Voice — Stage 4 isolated runtime benchmark

Date: 2026-08-14

## Decision summary

The production pipeline was not changed. The benchmark exports and executes isolated neural cores and compares them with the current PyTorch implementation.

- The best balanced candidate for all three tested models is **ONNX Runtime CUDA FP16**, subject to a shadow-mode, corpus-level downstream regression gate before activation.
- TensorRT has the best warm latency, but it is not the first production choice: dynamic-shape compilation took 31–87 seconds per shape, ordinary TensorRT added about 2.48 GB of research runtime, peak process RAM reached 5–8 GB, and several FP16 comparisons were not bit-equivalent.
- DirectML works with dynamic input lengths and is the most relevant broad Windows GPU fallback, but it was slower than the current CUDA baseline on this NVIDIA machine. It still needs AMD and Intel hardware measurements.
- ONNX Runtime CPU and OpenVINO CPU were substantially slower than the current CUDA baseline. They are compatibility candidates, not acceleration candidates on this PC.
- TensorRT for RTX was not measured: the current recommended standalone execution-provider plugin has no equivalent prebuilt Python package in the tested environment. Vendor claims are not substituted for project measurements.
- Tempo/key analysis was profiled only. HPSS/STFT dominates its roughly six seconds; no algorithm was changed.

No RoFormer or Qwen work was performed. No production dependency, installer, UI, or theme file was changed.

## Test system and method

| Item | Value |
|---|---|
| CPU | Intel Core Ultra 7 265KF, 20 cores / 20 logical processors |
| RAM | 33,962,196,992 bytes (31.63 GiB) |
| GPU | NVIDIA GeForce RTX 3060, compute capability 8.6 |
| VRAM | 8,192 MiB |
| Driver | 610.88 |
| PyTorch | 2.8.0+cu126 |
| ONNX Runtime | 1.22 |
| OpenVINO | 2025.2 |
| TensorRT | 10.9.0.34, CUDA 12 package |

Each backend used the same captured inputs and PyTorch reference outputs. Warm values are medians and include preprocessing, transfer/session input, inference, and existing postprocessing. Three dynamic lengths were exercised:

| Model | Short | Medium | Long |
|---|---:|---:|---:|
| FCPE | 10 s | 45 s | 120 s |
| RU/UK CTC | 2 s | 8 s | 20 s |

`Peak RAM` and `Peak VRAM` are process peaks observed during the isolated run, so they include loaded runtime libraries and allocator reservations. They are suitable for comparing these runs, but are not the model weights alone.

## Export and operator coverage

### FCPE

The exported graph is only the neural core:

```text
existing waveform -> STFT/mel preprocessing
                -> ONNX neural core [batch,time,128] -> [batch,frames,360]
                -> existing FCPE postprocessing
```

- Opset 18, 95 nodes, 10,832,592 parameters.
- Dynamic axes: batch and mel time; output frame count is dynamic.
- FP32 artifact: 43,333,230 bytes; FP16 artifact: 21,689,979 bytes.
- Operators: Add, Constant, Conv, Div, InstanceNormalization, LayerNormalization, LeakyRelu, MatMul, Mul, ReduceL2, Reshape, Shape, Sigmoid, Split, Transpose.
- No unsupported operator was found in CPU, CUDA, DirectML, OpenVINO CPU, ORT TensorRT EP, or ordinary TensorRT tests.
- This boundary deliberately keeps acoustic STFT/mel logic outside ONNX, minimizing result and maintenance risk.

### RU and UK Wav2Vec2 CTC

```text
waveform / existing normalization
                -> ONNX Wav2Vec2 network [batch,time] -> [batch,frames,vocab]
                -> existing CTC/Viterbi/reconciliation/downstream logic
```

| Model | Nodes | Parameters | Vocab | FP32 | FP16 |
|---|---:|---:|---:|---:|---:|
| RU CTC | 1,842 | 315,478,695 | 39 | 1,262,350,882 B | 631,563,228 B |
| UK CTC | 1,842 | 315,479,720 | 40 | 1,262,354,982 B | 631,565,278 B |

- Opset 18; dynamic batch, waveform time, and output frame axes.
- Operators: Add, Concat, Constant, Conv, Div, Erf, Gather, LayerNormalization, MatMul, Mul, ReduceL2, Reshape, Shape, Slice, Softmax, Transpose, Unsqueeze.
- No unsupported operator was found in tested providers.
- ONNX Runtime CUDA assigned the neural work to CUDA. It left 144 small shape operations on CPU: 48 Gather, 48 Unsqueeze, and 48 Concat operations. DirectML showed the same shape-plumbing split. These are not the main activation compute, but the provider transitions are measurable architecture debt.
- Export emitted a tracing warning for the Wav2Vec2 SDPA `is_causal` shape predicate. It is constant for all valid tested audio lengths (more than one encoded frame), and short/medium/long runs passed. A production exporter should nevertheless assert this precondition and retain a regression test.

## Performance results

The main tables report long-input full-stage time because it is the most discriminating shape. All successful rows were also stable for short and medium inputs. Runtime size is the isolated research package footprint, not a proposed installer addition.

### FCPE

| Backend | Precision | Export | Cold load | Warm full stage | Peak RAM | Peak VRAM | Artifact | Runtime | Quality delta vs PyTorch | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| PyTorch CUDA | FP32 | baseline | 0.178 s | **0.0750 s** | 1.21 GiB | 1.40 GiB | original | existing | reference | Current baseline |
| ORT CUDA | FP32 | pass | 0.682 s | 0.0888 s | 1.42 GiB | 1.78 GiB | 41.3 MiB | 507.6 MiB research dir | voiced 99.9917%; cents P95 0.012 | Slower |
| ORT CUDA | FP16 | pass | 0.727 s | **0.0640 s** | 1.69 GiB | 1.80 GiB | 20.7 MiB | 508.4 MiB research dir | voiced 100%; confidence MAE 0.000386; cents P95 0.100 | Candidate |
| ORT DirectML | FP32 | pass | 0.717 s | 0.1067 s | 1.17 GiB | 1.49 GiB | 41.3 MiB | 68.4 MiB | voiced 99.9917%; cents P95 0.047 | GPU fallback candidate |
| ORT DirectML | FP16 | pass | 0.480 s | 0.1227 s | 1.16 GiB | 1.38 GiB | 20.7 MiB | 68.4 MiB | voiced 100%; cents P95 0.225 | Reject on this PC |
| ORT CPU | FP32 | pass | 0.187 s | 0.3877 s | 1.31 GiB | 0.92 GiB | 41.3 MiB | 507.6 MiB research dir | cents P95 0.047 | Compatibility only |
| OpenVINO CPU | FP32 | pass | 0.862 s | 0.3609 s | 1.28 GiB | 0.90 GiB | 41.3 MiB | 126.4 MiB | cents P95 0.047 | Compatibility only |
| OpenVINO CPU | FP16 | pass | 0.712 s | 0.3522 s | 1.29 GiB | 1.00 GiB | 20.7 MiB | 126.4 MiB | cents P95 0.053 | Compatibility only |
| ORT TensorRT EP | FP16 | pass | 17.488 s | **0.0413 s** | 4.71 GiB | 6.03 GiB | 20.7 MiB + 23.4 MiB cache | 508.4 MiB + TRT libs | cents P95 0.217 | Fast warm, reject for first rollout |
| TensorRT | FP16 | pass | 0.065 s after build | 0.0551 s | 5.52 GiB | 5.88 GiB | 23.2 MiB engine | 2,366.1 MiB | cents P95 0.218 | Reject deployment tradeoff |
| OpenVINO GPU | FP32 | fail | — | — | — | — | 41.3 MiB | 126.4 MiB | no Intel GPU context | Not applicable on this PC |

ORT CUDA FP16 improves the long FCPE stage by **14.66%**. TensorRT EP improves warm latency by 44.93%, but its first dynamic shapes compiled in approximately 31.5, 44.4, and 87.0 seconds and repeatedly approached the 8 GiB VRAM limit. Ordinary TensorRT engine build took 51.71 seconds.

FCPE long-input mean cents error for FP16 is inflated by a very small number of outliers; P95 remains 0.100 cents and voiced agreement is 100%. This is a raw-core pass, not yet proof that acoustic notes, reference, MIDI, and songMap are unchanged over a representative song corpus.

### RU Wav2Vec2 CTC

| Backend | Precision | Export | Cold load | Warm full stage | Peak RAM | Peak VRAM | Artifact | Runtime | Quality delta vs PyTorch | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| PyTorch CUDA | FP16 autocast | baseline | 1.465 s | **0.1115 s** | 1.91 GiB | 3.37 GiB | original | existing | reference | Current baseline |
| ORT CUDA | FP32 | pass | 1.558 s | 0.1745 s | 1.65 GiB | 2.96 GiB | 1,203.9 MiB | 507.6 MiB | argmax 100% | Slower |
| ORT CUDA | FP16 | pass | 1.487 s | **0.0843 s** | 1.52 GiB | 2.05 GiB | 602.3 MiB | 508.4 MiB | argmax 100%; token/word MAE and P95 0 ms | Candidate |
| ORT DirectML | FP32 | pass | 1.379 s | 0.3372 s | 1.62 GiB | 2.68 GiB | 1,203.9 MiB | 68.4 MiB | argmax 100% | GPU fallback candidate |
| ORT DirectML | FP16 | pass | 0.913 s | 0.1883 s | 1.17 GiB | 2.20 GiB | 602.3 MiB | 68.4 MiB | argmax 99.8999% | Reject on this PC |
| ORT CPU | FP32 | pass | 1.409 s | 0.7682 s | 3.42 GiB | 0.92 GiB | 1,203.9 MiB | 508.4 MiB research dir | argmax 100% | Compatibility only |
| OpenVINO CPU | FP32 | pass | 1.960 s | 1.0365 s | 3.46 GiB | 0.92 GiB | 1,203.9 MiB | 126.4 MiB | argmax 100% | Compatibility only |
| OpenVINO CPU | FP16 | pass | 1.944 s | 0.9592 s | 3.48 GiB | 1.00 GiB | 602.3 MiB | 126.4 MiB | argmax 100% | Compatibility only |
| ORT TensorRT EP | FP16 | pass | 14.715 s | **0.0388 s** | 6.77 GiB | 2.70 GiB | 602.3 MiB + 610.1 MiB cache | ORT + TRT | long argmax 100%; medium 99.749% | Quality/cold-risk reject |
| TensorRT | FP16 | pass | 0.805 s after build | 0.0466 s | 7.58 GiB | 2.75 GiB | 641.6 MiB engine | 2,366.1 MiB | argmax 99.8999% | Reject deployment tradeoff |

ORT CUDA FP16 improves the long RU network stage by **24.39%**, reduces the measured process peak by about 0.39 GiB RAM and 1.32 GiB VRAM, and preserves long argmax exactly. Existing Viterbi on the medium and long references produced exactly matching token and word timings (MAE/P95 0 ms). The two-second sample contained no target tokens, so Viterbi correctly remained inapplicable there.

### UK Wav2Vec2 CTC

| Backend | Precision | Export | Cold load | Warm full stage | Peak RAM | Peak VRAM | Artifact | Runtime | Quality delta vs PyTorch | Status |
|---|---|---:|---:|---:|---:|---:|---:|---:|---|---|
| PyTorch CUDA | FP16 autocast | baseline | 1.172 s | **0.1105 s** | 1.90 GiB | 3.36 GiB | original | existing | reference | Current baseline |
| ORT CUDA | FP32 | pass | 1.646 s | 0.1576 s | 1.65 GiB | 3.02 GiB | 1,203.9 MiB | 508.4 MiB | argmax 100% | Slower |
| ORT CUDA | FP16 | pass | 1.138 s | **0.0853 s** | 1.52 GiB | 2.07 GiB | 602.3 MiB | 508.4 MiB | argmax 99.8999%; token/word MAE and P95 0 ms | Candidate |
| ORT DirectML | FP32 | pass | 1.354 s | 0.3379 s | 1.62 GiB | 2.68 GiB | 1,203.9 MiB | 68.4 MiB | argmax 100% | GPU fallback candidate |
| ORT DirectML | FP16 | pass | 9.770 s | 0.1877 s | 1.17 GiB | 2.19 GiB | 602.3 MiB | 68.4 MiB | argmax 100% | Reject on this PC |
| ORT CPU | FP32 | pass | 1.405 s | 0.7601 s | 3.22 GiB | 0.92 GiB | 1,203.9 MiB | 508.4 MiB research dir | argmax 100% | Compatibility only |
| OpenVINO CPU | FP32 | pass | 1.975 s | 1.0277 s | 3.46 GiB | 0.92 GiB | 1,203.9 MiB | 126.4 MiB | argmax 100% | Compatibility only |
| OpenVINO CPU | FP16 | pass | 1.891 s | 0.9801 s | 3.48 GiB | 1.02 GiB | 602.3 MiB | 126.4 MiB | argmax 100% | Compatibility only |
| ORT TensorRT EP | FP16 | pass | 15.240 s | **0.0382 s** | 6.68 GiB | 2.71 GiB | 602.3 MiB + 610.0 MiB cache | ORT + TRT | argmax 99.8999% | Quality/cold-risk reject |
| TensorRT | FP16 | pass | 0.684 s after build | 0.0753 s | 7.57 GiB | 2.69 GiB | 641.5 MiB engine | 2,366.1 MiB | argmax 99.8999% | Reject deployment tradeoff |

ORT CUDA FP16 improves the long UK network stage by **22.74%**, reduces measured process peak by about 0.38 GiB RAM and 1.29 GiB VRAM, and gives exactly matching Viterbi token/word timestamps on the medium and long references. Its long argmax difference is approximately one frame per thousand, so the unchanged downstream timing result is encouraging but not enough to waive the corpus gate.

## Quality gate status

| Output layer | FCPE ORT CUDA FP16 | RU CTC ORT CUDA FP16 | UK CTC ORT CUDA FP16 |
|---|---|---|---|
| Raw neural output | pass within recorded tolerances | pass | pass with 0.1001% argmax delta |
| Voiced/unvoiced | 100% agreement | n/a | n/a |
| Confidence | MAE 0.000386 | n/a | n/a |
| Pitch cents | P95 0.100 | n/a | n/a |
| Viterbi token timing | n/a | MAE/P95 0 ms | MAE/P95 0 ms |
| Word timing | n/a | MAE/P95 0 ms | MAE/P95 0 ms |
| Acoustic notes / reference / MIDI / songMap | not yet proven on a corpus | not yet proven on a CTC-active corpus | not yet proven on a CTC-active corpus |
| Production acceptance | **not yet** | **not yet** | **not yet** |

The current sample did not exercise every downstream CTC reconciliation path in the full pipeline. Consequently, the ONNX variants are **research candidates**, not accepted production replacements. Before activation, shadow mode must run PyTorch and the candidate on the same representative RU/UK corpus and compare serialized acoustic notes, syllables, reference, MIDI, and songMap under explicit thresholds.

FP32 and FP16 were tested separately. BF16 and INT8 were deliberately not accepted or benchmarked in this stage: BF16 operator/performance behavior still needs a separate provider check, while INT8 requires calibration and has a higher risk for pitch and timing boundaries. No speed claim is made for either.

## Model ranking

### FCPE

1. Production experiment candidate: ONNX Runtime CUDA FP16 — balanced 14.66% stage speedup, small model, strong raw quality.
2. Broad Windows GPU fallback candidate: DirectML FP32 — slower here, but portable to AMD/Intel; must be benchmarked on those devices.
3. Safe baseline: current PyTorch CUDA FP32.

### RU CTC

1. Production experiment candidate: ONNX Runtime CUDA FP16 — 24.39% stage speedup, lower measured RAM/VRAM, exact tested timings.
2. Broad Windows GPU fallback candidate: DirectML FP32 — stable and exact argmax here, though slower on RTX 3060.
3. Safe baseline: current PyTorch CUDA FP16 autocast.

### UK CTC

1. Production experiment candidate: ONNX Runtime CUDA FP16 — 22.74% stage speedup, lower measured RAM/VRAM, exact tested timings.
2. Broad Windows GPU fallback candidate: DirectML FP32 — stable and exact argmax here, though slower on RTX 3060.
3. Safe baseline: current PyTorch CUDA FP16 autocast.

TensorRT remains a later Tier-3 candidate only after shape-profile strategy, cache lifecycle, memory budgets, and corpus-level quality are solved. TensorRT for RTX deserves a separate isolated spike when its standalone EP can be built reproducibly; it is not a measured winner in this report.

## End-to-end implications

These results measure complete isolated model stages, not a production backend switch. Therefore no fabricated full-pipeline speedup is reported.

- FCPE is invoked multiple times, but Stage 1–3 telemetry attributes only about 0.317 seconds to current FCPE inference in the measured full song. Applying the observed 14.66% improvement would save roughly 0.047 seconds, about 0.1% of the 47.95-second warm pipeline. FCPE is a good low-risk adapter proof, not the largest end-to-end win.
- RU/UK CTC gains are larger per network call. The previous reference song did not reliably exercise a CTC-heavy alignment path, so a full-song percentage cannot be inferred. A multilingual, CTC-active corpus is required for the production decision.
- TensorRT's 55–65% warm network gain does not compensate for 50–87 second dynamic engine creation in the tested desktop workflow unless engines are cached and reused across many songs and shapes. Its peak RAM also conflicts with the weak-PC goal.

## Installer and runtime implications

### Canonical artifact

Keep the original PyTorch weights canonical for now. RoFormer, Qwen, and other current stages still require PyTorch, and the ONNX candidates have not passed the final downstream corpus gate.

If CTC production later moves to FP16 ONNX, the two CTC artifacts fall from about 2.527 GB FP32 ONNX-equivalent size to about 1.263 GB. Replacing, rather than duplicating, the original CTC model payload can save roughly 1.26 GB. FCPE FP16 saves about another 21.6 MB relative to its FP32 graph. Adding the measured ORT GPU research package costs about 363 MB for `onnxruntime` itself (the 508 MB benchmark directory also contains export-time tooling that is not required at runtime), leaving an estimated net installer reduction near 0.9 GB if originals are genuinely removed. If both formats are shipped, the installer grows instead.

PyTorch/CUDA cannot yet be removed because the untouched separation, Qwen, and other model stages still depend on them. Stage 4 alone therefore cannot deliver the much larger runtime reduction.

### Build-time versus first-run

- Build-time: export validated dynamic FP16 ONNX models, run ONNX checker and corpus quality hashes, and ship only accepted graphs.
- User PC: select provider, benchmark representative shapes, and create provider caches keyed by model/runtime/driver/hardware fingerprint.
- Ordinary TensorRT engines should not be built into the installer. TensorRT plans are constrained by platform, TensorRT version, GPU capability, and optimization profile; generate them on the target PC if that backend is ever enabled.
- TensorRT for RTX AOT/JIT hybrid artifacts may eventually be useful, but only after a reproducible standalone-EP benchmark. Current vendor size/build-time claims are not project evidence.

### Backend support recommendation

- Support first: PyTorch baseline plus an inactive BackendRegistry contract and ONNX Runtime CUDA FP16 shadow adapter.
- Evaluate next on real hardware: DirectML FP32 on AMD Radeon, Intel Arc/iGPU, and AMD iGPU.
- Retain as CPU compatibility candidates: ONNX Runtime CPU and OpenVINO CPU; choose only after CPU-family benchmarks.
- Defer: ordinary TensorRT and ORT TensorRT EP due cold compilation, memory, runtime size, and quality complexity.
- Research separately: TensorRT for RTX standalone EP.
- Do not pursue yet: INT8 and BF16 until FP16 downstream acceptance is complete.

It is appropriate to introduce `BackendRegistry` now as an interface/capability boundary, but not to change the selected production backend. The registry should describe model, provider, precision, dynamic-shape limits, memory budget, artifact fingerprint, quality-gate version, and ordered fallback. Provider selection must remain plan-level so transfer and runtime-switch costs can be included.

## Tempo/key analysis breakdown

Source duration: 145.12 seconds. Authoritative result remained BPM 144 / raw 143.555 and D# major. The first run took 7.764 seconds; subsequent runs took 5.857 and 5.827 seconds. Warm median breakdown:

| Operation | Time | Share of 5.8566 s |
|---|---:|---:|
| WAV read/decode | 0.0188 s | 0.32% |
| Stereo-to-mono | 0.0350 s | 0.60% |
| Resample | 0.0330 s | 0.56% |
| STFT/FFT + HPSS | **4.5516 s** | **77.72%** |
| Tempo onset | 0.2477 s | 4.23% |
| Beat tracking | 0.3941 s | 6.73% |
| Key/chroma CQT | 0.5207 s | 8.89% |
| Key scoring/windows | 0.0031 s | 0.05% |
| Other/unattributed | 0.0548 s | 0.94% |

The obvious bottleneck is HPSS/STFT, not file decode or resampling. Eliminating read, mono conversion, and resampling entirely would save at most about 87 ms on this song. A substantial tempo improvement requires an algorithmic or reuse decision around HPSS/chroma, which was explicitly outside this stage. Safe future work is to cache the HPSS/STFT products when another stage consumes exactly the same parameters; this must first be proven from telemetry because caching unused arrays would only increase RAM.

## Recommended first implementation

1. Add the inactive BackendRegistry and a shadow-only ORT adapter boundary.
2. Start with RU/UK CTC ORT CUDA FP16 because it has the largest balanced gain and lower measured memory; run a multilingual CTC-active corpus through the unchanged Viterbi/reconciliation/downstream stack.
3. Accept it only if token/word timing, syllables, reference, MIDI, and songMap pass explicit MAE/P95 and structural gates.
4. Then apply the same shadow mechanism to FCPE ORT CUDA FP16.
5. Benchmark DirectML FP32 on actual AMD and Intel hardware before calling it a production fallback.
6. Do not enable TensorRT, TensorRT EP, or TensorRT for RTX yet.

## Reproduction artifacts

Research scripts are under `scripts/ai_runtime_benchmark/`. Generated ONNX models, TensorRT caches, captured references, raw result JSON, provider assignment traces, and tempo profile are under ignored `build/ai-runtime-benchmark/`. Research dependencies were installed outside the repository in `D:\karaoke-ai-benchmark-deps`; they are not production requirements.

Verification after the benchmark:

- ONNX checker passed during every FP32 export; all FP16 converted graphs loaded successfully in their measured runtimes.
- Dynamic short/medium/long inference was stable for every successful row in the tables.
- Research scripts pass Ruff formatting, Ruff lint, and Python bytecode compilation.
- 157 focused production regression tests for FCPE, CTC alignment, text engines/helpers, music analysis, and AI runtime passed.

Primary technical references used for compatibility decisions:

- [ONNX Runtime CUDA Execution Provider](https://onnxruntime.ai/docs/execution-providers/CUDA-ExecutionProvider.html)
- [ONNX Runtime TensorRT Execution Provider](https://onnxruntime.ai/docs/execution-providers/TensorRT-ExecutionProvider.html)
- [ONNX Runtime DirectML Execution Provider](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html)
- [ONNX Runtime TensorRT for RTX Execution Provider](https://onnxruntime.ai/docs/execution-providers/TensorRTRTX-ExecutionProvider.html)
- [TensorRT support matrix](https://docs.nvidia.com/deeplearning/tensorrt/latest/getting-started/support-matrix.html)
- [TensorRT dynamic shapes](https://docs.nvidia.com/deeplearning/tensorrt/latest/inference-library/dynamic-shapes-basics.html)
- [TensorRT performance guidance](https://docs.nvidia.com/deeplearning/tensorrt/latest/performance/optimization.html)
- [TensorRT for RTX](https://developer.nvidia.com/tensorrt-rtx)
- [OpenVINO dynamic shapes](https://docs.openvino.ai/2025/openvino-workflow/running-inference/model-input-output/dynamic-shapes.html)
- [OpenVINO model caching](https://docs.openvino.ai/2025/openvino-workflow/running-inference/optimize-inference/optimizing-latency/model-caching-overview.html)
