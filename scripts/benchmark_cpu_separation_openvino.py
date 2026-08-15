from __future__ import annotations

import argparse
import hashlib
import os
import shutil
import subprocess
import tempfile
import time
from pathlib import Path

import numpy as np
import soundfile as sf


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _convert_input(source: Path, target: Path, seconds: float) -> None:
    try:
        from config import FFMPEG_EXE
        ffmpeg = FFMPEG_EXE
    except ImportError:
        ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    subprocess.run(
        [
            str(ffmpeg), "-hide_banner", "-loglevel", "error", "-y",
            "-i", str(source), "-t", str(seconds), "-ar", "44100", "-ac", "2",
            "-c:a", "pcm_s24le", str(target),
        ],
        check=True,
    )


def _set_common_env(threads: str) -> None:
    os.environ["KARAOKE_AI_RUNTIME_OVERRIDE"] = "cpu"
    os.environ["SONGAPP_DEVICE"] = "cpu"
    os.environ["KARAOKE_CPU_TUNING"] = "1"
    os.environ["KARAOKE_CPU_INTRAOP_THREADS"] = threads
    os.environ["KARAOKE_CPU_INTEROP_THREADS"] = "1"
    os.environ["KARAOKE_CPU_INFERENCE_MODE"] = "1"


def _clear_compile_env() -> None:
    for name in (
        "KARAOKE_CPU_COMPILE",
        "KARAOKE_CPU_COMPILE_BACKEND",
        "KARAOKE_CPU_COMPILE_MODE",
        "KARAOKE_CPU_COMPILE_DYNAMIC",
        "KARAOKE_CPU_COMPILE_REQUIRED",
        "KARAOKE_OPENVINO_CACHE_DIR",
    ):
        os.environ.pop(name, None)


def _run_once(separator, mix: Path, out: Path) -> dict[str, object]:
    out.mkdir(parents=True, exist_ok=True)
    vocals, instrumental = out / "vocals.wav", out / "instrumental.wav"
    started = time.perf_counter()
    separator.separate(mix, vocals, instrumental)
    return {
        "sec": time.perf_counter() - started,
        "vocals": vocals,
        "instrumental": instrumental,
        "vocals_sha": _sha256(vocals),
        "instrumental_sha": _sha256(instrumental),
    }


def _load_separator(root: Path):
    from AI import runtime
    from AI.engines.separation import MSSTMelRoformerSeparator

    runtime.configure_runtime("cpu", force=True)
    separator = MSSTMelRoformerSeparator(idle_timeout_sec=1800)
    arguments = {
        "model_type": "mel_band_roformer",
        "config_path": str(Path(separator.config).resolve()),
        "start_check_point": str(Path(separator.checkpoint).resolve()),
        "input_folder": str(root),
        "store_dir": str(root / "warmup"),
    }
    started = time.perf_counter()
    separator._ensure_worker(arguments)
    return separator, time.perf_counter() - started


def _diff_metrics(reference: Path, candidate: Path) -> tuple[float, float]:
    ref, sr1 = sf.read(reference, dtype="float32", always_2d=True)
    got, sr2 = sf.read(candidate, dtype="float32", always_2d=True)
    if sr1 != sr2 or ref.shape != got.shape:
        return float("inf"), float("inf")
    delta = got - ref
    return float(np.max(np.abs(delta))), float(np.sqrt(np.mean(delta * delta)))


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="A/B RoFormer CPU PyTorch vs OpenVINO pilot")
    parser.add_argument("input", type=Path)
    parser.add_argument("--seconds", type=float, default=8.0)
    parser.add_argument("--threads", default="auto")
    args = parser.parse_args(argv)
    source = args.input.expanduser().resolve()
    if not source.is_file():
        parser.error(f"input file does not exist: {source}")

    with tempfile.TemporaryDirectory(prefix="advoice-openvino-roformer-") as tmp:
        root = Path(tmp)
        mix = root / "sample.wav"
        _convert_input(source, mix, args.seconds)
        _set_common_env(args.threads)

        print(f"A&D Voice RoFormer CPU backend pilot ({args.seconds:g}s, threads={args.threads})")
        print("\n[1/2] PyTorch tuned eager")
        _clear_compile_env()
        eager, eager_load = _load_separator(root / "eager")
        try:
            baseline = _run_once(eager, mix, root / "eager-out")
        finally:
            eager.close()
        print(f"      load       : {eager_load:.3f}s")
        print(f"      separation : {baseline['sec']:.3f}s")

        print("\n[2/2] OpenVINO torch.compile CPU")
        _set_common_env(args.threads)
        os.environ["KARAOKE_CPU_COMPILE"] = "1"
        os.environ["KARAOKE_CPU_COMPILE_BACKEND"] = "openvino"
        os.environ["KARAOKE_CPU_COMPILE_DYNAMIC"] = "1"
        os.environ["KARAOKE_CPU_COMPILE_REQUIRED"] = "1"
        os.environ["KARAOKE_OPENVINO_CACHE_DIR"] = str(
            Path.cwd() / "downloads" / "cache" / "openvino-roformer"
        )
        ov, ov_load = _load_separator(root / "openvino")
        try:
            cold = _run_once(ov, mix, root / "ov-cold")
            warm = _run_once(ov, mix, root / "ov-warm")
        finally:
            ov.close()
        print(f"      load       : {ov_load:.3f}s")
        print(f"      cold       : {cold['sec']:.3f}s")
        print(f"      warm       : {warm['sec']:.3f}s")

        identical = (
            baseline["vocals_sha"] == warm["vocals_sha"]
            and baseline["instrumental_sha"] == warm["instrumental_sha"]
        )
        vmax, vrms = _diff_metrics(baseline["vocals"], warm["vocals"])
        imax, irms = _diff_metrics(baseline["instrumental"], warm["instrumental"])
        speedup = float(baseline["sec"]) / float(warm["sec"]) if warm["sec"] else 0.0

        print("\n============================================================")
        print(" RESULT")
        print("============================================================")
        print(f"PyTorch tuned eager : {baseline['sec']:.3f}s")
        print(f"OpenVINO cold       : {cold['sec']:.3f}s")
        print(f"OpenVINO warm       : {warm['sec']:.3f}s")
        print(f"Warm speedup        : {speedup:.3f}x")
        print(f"Stems byte-identical: {'YES' if identical else 'NO'}")
        print(f"Vocals max/rms diff : {vmax:.9f} / {vrms:.9f}")
        print(f"Inst. max/rms diff  : {imax:.9f} / {irms:.9f}")

        marker = Path.cwd() / "downloads" / "cache" / "ai-runtime" / "cpu-separation-backend.txt"
        if identical and warm["sec"] < baseline["sec"]:
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text("openvino\n", encoding="ascii")
            print(f"\n[PASS] Faster with byte-identical stems. Saved backend: {marker}")
            print("       start-dev-cpu.bat will use OpenVINO automatically.")
            return 0

        print("\n[STOP] OpenVINO was NOT enabled automatically.")
        if not identical:
            print("       Output differs; downstream quality validation is required first.")
        elif warm["sec"] >= baseline["sec"]:
            print("       Output matches, but OpenVINO is not faster on this CPU/model.")
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
