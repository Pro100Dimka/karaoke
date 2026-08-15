from __future__ import annotations

import argparse
import contextlib
import hashlib
import importlib
import json
import os
import shutil
import subprocess
import sys
import tempfile
import time
import urllib.request
import zipfile
from pathlib import Path

import numpy as np

REPO_API = "https://api.github.com/repos/ZFTurbo/MSS_ONNX_TensorRT/commits/main"
REPO_ZIP = "https://codeload.github.com/ZFTurbo/MSS_ONNX_TensorRT/zip/{sha}"
PILOT_ONNX = "onnx==1.18.0"
PILOT_ORT = "onnxruntime==1.22.1"
PILOT_PURE = ("ml_collections", "loralib")


def sha256(path: Path) -> str:
    h = hashlib.sha256()
    with path.open("rb") as f:
        for chunk in iter(lambda: f.read(8 * 1024 * 1024), b""):
            h.update(chunk)
    return h.hexdigest()


def run(cmd: list[str], *, cwd: Path | None = None, env: dict[str, str] | None = None, check: bool = True) -> subprocess.CompletedProcess[str]:
    print("$", subprocess.list2cmdline(cmd), flush=True)
    return subprocess.run(cmd, cwd=cwd, env=env, text=True, check=check)


def request_json(url: str) -> dict:
    req = urllib.request.Request(url, headers={"User-Agent": "A&D-Voice-ONNX-pilot/1"})
    with urllib.request.urlopen(req, timeout=60) as r:  # noqa: S310 - fixed GitHub URL
        return json.load(r)


def download(url: str, target: Path) -> None:
    target.parent.mkdir(parents=True, exist_ok=True)
    req = urllib.request.Request(url, headers={"User-Agent": "A&D-Voice-ONNX-pilot/1"})
    with urllib.request.urlopen(req, timeout=180) as r, target.open("wb") as f:  # noqa: S310
        shutil.copyfileobj(r, f)


def ensure_pilot_deps(py: Path, target: Path) -> None:
    """Install a deterministic isolated ONNX/ORT pair without touching the app venv.

    ONNX 1.19+ imports newer ml_dtypes scalar types. The application venv can
    legitimately contain an older ml_dtypes because TensorFlow pins it, so a
    --no-deps install of latest ONNX can accidentally import the venv copy and
    fail before the pilot starts. For this opset-17 export we intentionally pin
    ONNX 1.18.0, which predates that dependency and is sufficient for the
    exporter. ORT is pinned too so repeated runs are reproducible.
    """
    target.mkdir(parents=True, exist_ok=True)
    probe = (
        "import sys; sys.path.insert(0, r'" + str(target) + "'); "
        "import onnx, onnxruntime as ort; "
        "assert onnx.__version__ == '1.18.0', onnx.__version__; "
        "assert ort.__version__ == '1.22.1', ort.__version__; "
        "assert 'CPUExecutionProvider' in ort.get_available_providers(), ort.get_available_providers(); "
        "print('onnx', onnx.__version__, 'onnxruntime', ort.__version__, 'providers', ort.get_available_providers())"
    )
    checked = subprocess.run(
        [str(py), "-c", probe], text=True, capture_output=True, check=False
    )
    if checked.returncode == 0:
        print(checked.stdout.strip(), flush=True)
        return

    print("Preparing isolated ONNX CPU pilot dependencies...", flush=True)
    # Remove stale pilot-only package copies first. This never touches backend/venv.
    for pattern in (
        "onnx", "onnx-*.dist-info", "onnxruntime", "onnxruntime-*.dist-info",
        "onnxruntime.libs", "ml_dtypes", "ml_dtypes-*.dist-info",
    ):
        for item in target.glob(pattern):
            if item.is_dir():
                shutil.rmtree(item, ignore_errors=True)
            else:
                item.unlink(missing_ok=True)

    run([
        str(py), "-m", "pip", "install", "--quiet", "--disable-pip-version-check", "--no-input",
        "--upgrade", "--force-reinstall", "--target", str(target), "--no-deps",
        PILOT_ONNX, PILOT_ORT, *PILOT_PURE,
    ])
    verified = subprocess.run(
        [str(py), "-c", probe], text=True, capture_output=True, check=False
    )
    if verified.returncode != 0:
        if verified.stdout.strip():
            print(verified.stdout.strip(), flush=True)
        if verified.stderr.strip():
            print(verified.stderr.strip(), file=sys.stderr, flush=True)
        raise RuntimeError("Isolated ONNX/ORT dependency probe failed")
    print(verified.stdout.strip(), flush=True)


def patch_upstream_for_cpu_only(source: Path) -> None:
    utils = source / "utils.py"
    text = utils.read_text(encoding="utf-8")
    old = "import tensorrt as trt\nimport pycuda.driver as cuda\n"
    new = (
        "try:\n    import tensorrt as trt\nexcept ImportError:\n    trt = None\n"
        "try:\n    import pycuda.driver as cuda\nexcept ImportError:\n    cuda = None\n"
    )
    if old in text:
        utils.write_text(text.replace(old, new, 1), encoding="utf-8")


def ensure_upstream(cache: Path) -> tuple[Path, str]:
    meta = request_json(REPO_API)
    sha = str(meta["sha"])
    root = cache / f"MSS_ONNX_TensorRT-{sha}"
    if root.is_dir() and (root / "export_to_onnx.py").is_file():
        patch_upstream_for_cpu_only(root)
        return root, sha

    archive = cache / f"MSS_ONNX_TensorRT-{sha}.zip"
    print(f"Downloading ZFTurbo/MSS_ONNX_TensorRT @ {sha[:12]}...", flush=True)
    if not archive.is_file():
        download(REPO_ZIP.format(sha=sha), archive)
    temp = cache / f".extract-{sha}"
    shutil.rmtree(temp, ignore_errors=True)
    temp.mkdir(parents=True)
    with zipfile.ZipFile(archive) as zf:
        zf.extractall(temp)
    candidates = [p for p in temp.iterdir() if p.is_dir()]
    if len(candidates) != 1:
        raise RuntimeError("Unexpected GitHub archive layout")
    if root.exists():
        shutil.rmtree(root)
    candidates[0].rename(root)
    shutil.rmtree(temp, ignore_errors=True)
    patch_upstream_for_cpu_only(root)
    return root, sha


def env_with_paths(source: Path, deps: Path) -> dict[str, str]:
    env = os.environ.copy()
    parts = [str(source), str(deps)]
    if env.get("PYTHONPATH"):
        parts.append(env["PYTHONPATH"])
    env["PYTHONPATH"] = os.pathsep.join(parts)
    env["CUDA_VISIBLE_DEVICES"] = "-1"
    env["ORT_LOG_SEVERITY_LEVEL"] = "3"
    return env


def export_onnx(py: Path, source: Path, deps: Path, config: Path, checkpoint: Path, artifact: Path) -> float:
    artifact.parent.mkdir(parents=True, exist_ok=True)
    fingerprint = artifact.with_suffix(".fingerprint.json")
    expected = {
        "checkpoint_sha256": sha256(checkpoint),
        "config_sha256": sha256(config),
        "exporter_sha": source.name.removeprefix("MSS_ONNX_TensorRT-"),
        "opset": 17,
        "onnx": "1.18.0",
        "onnxruntime": "1.22.1",
    }
    if artifact.is_file() and fingerprint.is_file():
        with contextlib.suppress(Exception):
            if json.loads(fingerprint.read_text(encoding="utf-8")) == expected:
                print(f"Reusing cached ONNX artifact: {artifact}", flush=True)
                return 0.0

    artifact.unlink(missing_ok=True)
    started = time.perf_counter()
    run([
        str(py), str(source / "export_to_onnx.py"),
        "--model_type", "mel_band_roformer",
        "--config_path", str(config),
        "--checkpoint_path", str(checkpoint),
        "--output_path", str(artifact),
        "--opset_version", "17",
        "--force_cpu",
    ], cwd=source, env=env_with_paths(source, deps))
    elapsed = time.perf_counter() - started
    if not artifact.is_file() or artifact.stat().st_size < 10_000_000:
        raise RuntimeError("ONNX export did not produce a plausible artifact")
    fingerprint.write_text(json.dumps(expected, indent=2), encoding="utf-8")
    return elapsed


def convert_sample(root: Path, source: Path, target: Path, seconds: float) -> None:
    sys.path.insert(0, str(root / "backend"))
    try:
        from config import FFMPEG_EXE
        ffmpeg = str(FFMPEG_EXE)
    except Exception:
        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    run([
        ffmpeg, "-hide_banner", "-loglevel", "error", "-y", "-i", str(source),
        "-t", str(seconds), "-ar", "44100", "-ac", "2", "-c:a", "pcm_s24le", str(target),
    ])


def run_pytorch_baseline(root: Path, sample: Path, out: Path, threads: int) -> tuple[float, np.ndarray, np.ndarray]:
    backend = root / "backend"
    if str(backend) not in sys.path:
        sys.path.insert(0, str(backend))
    from AI import runtime
    from AI.engines.separation import MSSTMelRoformerSeparator
    import soundfile as sf

    os.environ["KARAOKE_AI_RUNTIME_OVERRIDE"] = "cpu"
    os.environ["SONGAPP_DEVICE"] = "cpu"
    os.environ["KARAOKE_CPU_TUNING"] = "1"
    os.environ["KARAOKE_CPU_INTRAOP_THREADS"] = str(threads)
    os.environ["KARAOKE_CPU_INTEROP_THREADS"] = "1"
    os.environ["KARAOKE_CPU_INFERENCE_MODE"] = "1"
    os.environ["KARAOKE_CPU_COMPILE"] = "0"
    runtime.configure_runtime("cpu", force=True)

    out.mkdir(parents=True, exist_ok=True)
    vocals = out / "vocals.wav"
    instrumental = out / "instrumental.wav"
    sep = MSSTMelRoformerSeparator(idle_timeout_sec=1800)
    args = {
        "model_type": "mel_band_roformer",
        "config_path": str(Path(sep.config).resolve()),
        "start_check_point": str(Path(sep.checkpoint).resolve()),
        "input_folder": str(out),
        "store_dir": str(out),
    }
    sep._ensure_worker(args)
    started = time.perf_counter()
    try:
        sep.separate(sample, vocals, instrumental)
    finally:
        elapsed = time.perf_counter() - started
        sep.close()
    v, sr = sf.read(vocals, dtype="float32", always_2d=True)
    i, sr2 = sf.read(instrumental, dtype="float32", always_2d=True)
    if sr != sr2:
        raise RuntimeError("Baseline stem sample-rate mismatch")
    return elapsed, v.T, i.T


def write_onnx_worker(path: Path) -> None:
    path.write_text(r'''from __future__ import annotations
import argparse, json, os, sys, time
from pathlib import Path
import numpy as np
import soundfile as sf

p=argparse.ArgumentParser(); p.add_argument('--source',type=Path,required=True); p.add_argument('--deps',type=Path,required=True); p.add_argument('--config',type=Path,required=True); p.add_argument('--onnx',type=Path,required=True); p.add_argument('--sample',type=Path,required=True); p.add_argument('--threads',type=int,required=True); p.add_argument('--out',type=Path,required=True); a=p.parse_args()
sys.path.insert(0,str(a.source)); sys.path.insert(1,str(a.deps))
import onnxruntime as ort
from utils import demix, load_config, normalize_audio, denormalize_audio, prefer_target_instrument

config=load_config('mel_band_roformer', str(a.config))
opts=ort.SessionOptions(); opts.graph_optimization_level=ort.GraphOptimizationLevel.ORT_ENABLE_ALL; opts.intra_op_num_threads=a.threads; opts.inter_op_num_threads=1; opts.execution_mode=ort.ExecutionMode.ORT_SEQUENTIAL
load0=time.perf_counter(); sess=ort.InferenceSession(str(a.onnx), sess_options=opts, providers=['CPUExecutionProvider']); load=time.perf_counter()-load0
providers=sess.get_providers()
if providers != ['CPUExecutionProvider']:
    raise RuntimeError(f'Unexpected ONNX providers: {providers}')

raw,sr=sf.read(a.sample,dtype='float32',always_2d=True); mix=raw.T.copy(); mix_orig=mix.copy()
normalize=bool(getattr(config.inference,'normalize',False)); norm=None
if normalize: mix,norm=normalize_audio(mix)

def once():
    t=time.perf_counter(); stems=demix(config,sess,mix,'cpu',model_type='mel_band_roformer',pbar=False,use_onnx=True,use_tensorrt=False,use_compile=False); dt=time.perf_counter()-t
    if not isinstance(stems,dict) or not stems: raise RuntimeError('ONNX demix returned no stems')
    keys=prefer_target_instrument(config); key='vocals' if 'vocals' in stems else keys[0]
    vocal=np.asarray(stems[key],dtype=np.float32)
    if normalize: vocal=np.asarray(denormalize_audio(vocal,norm),dtype=np.float32)
    inst=mix_orig-vocal
    return dt,vocal,inst
cold,_,_=once(); warm,vocal,inst=once()
a.out.mkdir(parents=True,exist_ok=True); np.save(a.out/'vocals.npy',vocal); np.save(a.out/'instrumental.npy',inst)
(a.out/'metrics.json').write_text(json.dumps({'session_load_sec':load,'cold_sec':cold,'warm_sec':warm,'providers':providers,'input_shape':sess.get_inputs()[0].shape,'output_shape':sess.get_outputs()[0].shape},indent=2),encoding='utf-8')
print(json.dumps({'session_load_sec':load,'cold_sec':cold,'warm_sec':warm,'providers':providers,'input_shape':sess.get_inputs()[0].shape,'output_shape':sess.get_outputs()[0].shape},indent=2))
''', encoding="utf-8")


def compare(ref: np.ndarray, got: np.ndarray) -> tuple[float, float]:
    if ref.shape != got.shape:
        raise RuntimeError(f"Shape mismatch: {ref.shape} vs {got.shape}")
    d = ref.astype(np.float64) - got.astype(np.float64)
    return float(np.max(np.abs(d))), float(np.sqrt(np.mean(d * d)))


def self_test() -> int:
    x=np.array([[0.0,1.0]],dtype=np.float32); y=x.copy(); mx,rms=compare(x,y)
    assert mx==0 and rms==0
    print("[SELF-TEST PASS] helper logic is valid")
    return 0


def main() -> int:
    ap=argparse.ArgumentParser(description="Strict Mel-Band RoFormer ONNX CPU feasibility test. Does not modify production source.")
    ap.add_argument("input", nargs="?", type=Path)
    ap.add_argument("--seconds", type=float, default=8.0)
    ap.add_argument("--threads", type=int, default=20)
    ap.add_argument("--self-test", action="store_true")
    a=ap.parse_args()
    if a.self_test: return self_test()
    if a.input is None: ap.error("input is required")
    root=Path.cwd().resolve(); py=root/"backend/venv/Scripts/python.exe"
    source_audio=a.input.expanduser().resolve()
    config=root/"downloads/engines/msst/configs/KimberleyJensen/config_vocals_mel_band_roformer_kj.yaml"
    checkpoint=root/"downloads/models/roformer/MelBandRoformer.ckpt"
    for p,name in ((py,"backend venv Python"),(source_audio,"input audio"),(config,"MSST config"),(checkpoint,"RoFormer checkpoint")):
        if not p.is_file(): raise SystemExit(f"[FAIL] Missing {name}: {p}")
    if a.seconds<=0 or a.threads<=0: raise SystemExit("[FAIL] seconds/threads must be > 0")

    cache=root/"downloads/cache/ai-runtime/roformer-onnx-pilot"; deps=cache/"python"; repo_cache=cache/"upstream"; artifact=cache/"MelBandRoformer-core.onnx"
    print("============================================================")
    print(" A&D Voice - STRICT RoFormer ONNX CPU feasibility test")
    print("============================================================")
    print("No production source files are modified.")
    print("ONNX Runtime provider is forced to CPUExecutionProvider only.\n")
    ensure_pilot_deps(py,deps)
    upstream,rev=ensure_upstream(repo_cache); print(f"Upstream exporter: ZFTurbo/MSS_ONNX_TensorRT {rev[:12]}")
    try:
        export_sec=export_onnx(py,upstream,deps,config,checkpoint,artifact)
    except Exception as exc:
        print(f"\n[STRICT FAIL] ONNX export/validation failed: {type(exc).__name__}: {exc}")
        return 10
    print(f"ONNX artifact: {artifact} ({artifact.stat().st_size/1024/1024:.1f} MiB), export={export_sec:.1f}s")

    with tempfile.TemporaryDirectory(prefix="advoice-roformer-onnx-strict-") as td:
        work=Path(td); sample=work/"sample_0.wav"; convert_sample(root,source_audio,sample,a.seconds)
        print(f"\n[1/2] PyTorch tuned CPU (threads={a.threads})")
        pt_sec,pt_v,pt_i=run_pytorch_baseline(root,sample,work/"pytorch",a.threads); print(f"PyTorch separation: {pt_sec:.3f}s")
        print("\n[2/2] ONNX Runtime CPU (STRICT, no other EP)")
        helper=work/"onnx_worker.py"; write_onnx_worker(helper); out=work/"onnx"
        env=env_with_paths(upstream,deps); env["OMP_NUM_THREADS"]=str(a.threads); env["MKL_NUM_THREADS"]=str(a.threads)
        try:
            run([str(py),str(helper),"--source",str(upstream),"--deps",str(deps),"--config",str(config),"--onnx",str(artifact),"--sample",str(sample),"--threads",str(a.threads),"--out",str(out)],env=env)
        except Exception as exc:
            print(f"\n[STRICT FAIL] Real ONNX CPU inference failed: {type(exc).__name__}: {exc}")
            return 11
        metrics=json.loads((out/"metrics.json").read_text(encoding="utf-8")); ov_v=np.load(out/"vocals.npy"); ov_i=np.load(out/"instrumental.npy")
        vmax,vrms=compare(pt_v,ov_v); imax,irms=compare(pt_i,ov_i); warm=float(metrics["warm_sec"]); speed=pt_sec/warm if warm else 0.0
        numerical=(vmax<=1e-4 and vrms<=1e-5 and imax<=1e-4 and irms<=1e-5)
        useful=(speed>=1.15)
        print("\n============================================================"); print(" RESULT"); print("============================================================")
        print(f"PyTorch tuned CPU : {pt_sec:.3f}s")
        print(f"ONNX session load : {float(metrics['session_load_sec']):.3f}s")
        print(f"ONNX cold         : {float(metrics['cold_sec']):.3f}s")
        print(f"ONNX warm         : {warm:.3f}s")
        print(f"Warm speedup      : {speed:.3f}x")
        print(f"Providers         : {metrics['providers']}")
        print(f"Vocals max/rms    : {vmax:.9f} / {vrms:.9f}")
        print(f"Inst. max/rms     : {imax:.9f} / {irms:.9f}")
        print(f"Numerical gate    : {'PASS' if numerical else 'FAIL'}")
        print(f"Benefit gate      : {'PASS' if useful else 'FAIL'} (requires >=1.15x)")
        if not numerical:
            print("\n[STRICT FAIL] Output drift is too large. Do not integrate this backend."); return 12
        if not useful:
            print("\n[STRICT STOP] ONNX is valid, but the speedup is too small to justify integration."); return 13
        print("\n[FEASIBILITY PASS] Real ONNX CPU is materially faster with a tight numerical match.")
        print("Next step is a full-song/downstream shadow gate before any production archive.")
        return 0

if __name__=="__main__":
    raise SystemExit(main())
