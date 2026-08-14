# AI runtime baseline — stages 1–3

Date: 2026-08-14  
Scope: current PyTorch/MSST pipeline only. No ONNX, TensorRT, OpenVINO or DirectML changes.

## Reproducible input and environment

- Input: `build/performance-baseline-input/source.mp3`
- Size: 5,807,587 bytes
- SHA-256: `9D4B03D737379FBD46C4226B443F84574FF25FED7890BD614CA3F7A47294B1E1`
- Duration: about 139 seconds
- Hardware: NVIDIA RTX 3060 8 GB, 20 logical CPU cores
- Runtime: Python 3.12, PyTorch 2.8.0+cu126, CUDA execution
- Before: `build/performance-baseline-before-v2/baseline.json`
- After: `build/performance-baseline-after-v2/baseline.json`

Cold means a new `KaraokePipeline` with no process-resident AI models. Warm is the next
uncached song run in the same process. Filesystem cache state is not controllable on Windows,
so cold model-load time is reported but the warm comparison is the more stable performance
signal.

## Before / after

| Metric | Before | After | Difference |
|---|---:|---:|---:|
| Full pipeline, cold | 132.509 s | 121.395 s | -11.115 s (-8.4%) |
| Full pipeline, warm | 54.094 s | 47.949 s | -6.145 s (-11.4%) |
| Separation, cold | 24.631 s | 31.440 s | +6.809 s (+27.6%)* |
| Separation, warm | 28.091 s | 21.380 s | -6.712 s (-23.9%) |
| Pitch total, cold | 3.867 s | 2.882 s | -0.985 s (-25.5%) |
| Pitch total, warm | 1.303 s | 1.479 s | +0.176 s (+13.5%)* |
| ASR, cold | 79.947 s | 62.179 s | -17.768 s (-22.2%)* |
| ASR, warm | 9.592 s | 9.840 s | +0.249 s (+2.6%)* |
| Alignment, cold | 2.462 s | 2.453 s | -0.009 s (-0.4%) |
| Alignment, warm | 1.202 s | 1.163 s | -0.039 s (-3.3%) |
| Peak family RAM, cold | 5,710.9 MB | 7,982.6 MB | +2,271.7 MB (+39.8%)** |
| Peak family RAM, warm | 9,667.7 MB | 9,473.6 MB | -194.0 MB (-2.0%) |
| Peak system VRAM, cold | 7,240 MB | 7,793 MB | +553 MB (+7.6%)** |
| Peak system VRAM, warm | 7,879 MB | 7,820 MB | -59 MB (-0.7%) |
| OS disk reads, cold | 3.128 GB | 2.900 GB | -228 MB (-7.3%) |
| OS disk reads, warm | 2.878 GB | 1.679 GB | -1.199 GB (-41.6%) |
| OS disk writes, cold | 231.2 MB | 195.1 MB | -36.0 MB (-15.6%) |
| OS disk writes, warm | 244.9 MB | 213.5 MB | -31.3 MB (-12.8%) |
| Physical `load_mono` reads, cold | 10 | 5 | -5 (-50.0%) |
| Physical `load_mono` reads, warm | 17 | 12 | -5 (-29.4%) |
| Physical resamples per run | 9 | 4 | -5 (-55.6%) |
| RoFormer model loads, cold + warm | 2 | 1 | -1 (-50.0%) |
| Decode calls per run | 1 | 1 | unchanged |
| Peak GPU utilization | 100% | 100% | unchanged |

\* Cold model loading and sub-second stages vary with HDD/filesystem cache and background
load. They are not attributed entirely to the code change. The repeatable gain is warm
separation and end-to-end warm time.

\** The persistent RoFormer worker retains CPU weights to avoid the next checkpoint load.
This raises first-run peak RAM. It releases GPU memory immediately after separation and exits
after a configurable idle period (`KARAOKE_MSST_IDLE_TIMEOUT_SEC`, default 120 seconds).

## Bottlenecks confirmed before changes

1. MSST spawned a fresh Python process, reconstructed RoFormer and loaded the 913 MB
   checkpoint for every song.
2. The same vocal WAV/sample-rate pair was read and resampled repeatedly by pitch, ASR,
   alignment and diagnostics.
3. Separation copied the complete decoded `song.wav` into a temporary folder even on the same
   NTFS volume.
4. The pipeline had stage timings but no coherent end-to-end operation, resource or model-load
   telemetry.
5. Warm processing still read 2.88 GB from storage for a 5.8 MB compressed source.

## Changes

- Added per-run `performance.json`, also referenced by the manifest and diagnostics.
- Added stage, model-load, preprocessing, inference, postprocessing, transfer, process-tree
  RAM/CPU/I/O and parent CUDA allocation telemetry.
- Added a pipeline-scoped immutable-result PCM cache. Callers still receive independent NumPy
  arrays, preserving mutation semantics, while identical reads/resamples execute once.
- Added a persistent isolated MSST worker. RoFormer loads once, moves to GPU only for
  separation, then moves back to CPU and clears the CUDA cache.
- Added bounded worker shutdown, crash/timeout handling and service shutdown cleanup.
- Replaced the full temporary separation input copy with an NTFS hardlink and safe copy
  fallback.
- Instrumented FCPE, Qwen ASR, Qwen aligner and CTC model load/inference boundaries and known
  CPU-to-GPU transfers.

## Quality regression gate

All 14 compared production artifacts are byte-identical before and after in both cold and
warm runs: vocals, instrumental, music analysis, raw/stabilized pitch, lyrics, word timing,
syllables, acoustic notes, reference, both MIDI files, songMap and quality report.

The quality metrics are also exactly unchanged for both runs. Example cold values:

- overall: `0.61694403515544`
- pitch confidence: `0.7621577450927257`
- pitch coverage: `0.9021499448732084`
- alignment confidence: `0.15343434343434342`
- word coverage: `0.6973003236578701`
- note coverage: `0.9438668518230807`

## Remaining bottlenecks

- RoFormer inference itself is about 20.3 seconds warm; backend/precision changes belong to
  stage 4 and were intentionally not started.
- Qwen ASR inference is about 9.8 seconds warm; checkpoint loading is highly storage-sensitive.
- Tempo analysis remains about 6.0 seconds warm.
- Three intentionally different vocal preprocessing variants still require full WAV artifacts.
- Keeping RoFormer CPU weights improves repeat processing but costs RAM until the idle timeout;
  the future Runtime Manager should select retention based on the machine memory budget.
- Reliable whole-device GPU utilization/VRAM comes from the external benchmark monitor.
  Built-in telemetry reports exact parent PyTorch CUDA allocations and process-tree resources;
  it does not poll `nvidia-smi` during ordinary app use.
- Child-process RoFormer CPU-to-GPU byte counts are not yet exported, though their time is
  included in separation inference and end-to-end measurements.

Stage 4 is intentionally not implemented or started.
