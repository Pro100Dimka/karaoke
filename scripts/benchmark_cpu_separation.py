
import argparse
import os
import shutil
import subprocess
import sys
import tempfile
import time
from pathlib import Path
from ai_runtime_benchmark.common import sha256



def _convert_input(source: Path, target: Path, seconds: float) -> None:
    try:
        from config import FFMPEG_EXE

        ffmpeg = FFMPEG_EXE
    except ImportError: ffmpeg = shutil.which("ffmpeg") or "ffmpeg"
    command = [
        str(ffmpeg),
        "-hide_banner",
        "-loglevel",
        "error",
        "-y",
        "-i",
        str(source),
        "-t",
        str(seconds),
        "-ar",
        "44100",
        "-ac",
        "2",
        "-c:a",
        "pcm_s24le",
        str(target),
    ]
    subprocess.run(command, check=True)


def _run_profile(label: str, mix: Path, root: Path, *, tuned: bool, threads: str):
    from AI import runtime; from AI.engines.separation import MSSTMelRoformerSeparator

    os.environ["KARAOKE_AI_RUNTIME_OVERRIDE"] = "cpu"; os.environ["SONGAPP_DEVICE"] = "cpu"
    if tuned:
        os.environ["KARAOKE_CPU_TUNING"] = "1"; os.environ["KARAOKE_CPU_INTRAOP_THREADS"] = threads; os.environ["KARAOKE_CPU_INTEROP_THREADS"] = "1"; os.environ["KARAOKE_CPU_INFERENCE_MODE"] = "1"
    else:
        for name in (
            "KARAOKE_CPU_TUNING",
            "KARAOKE_CPU_INTRAOP_THREADS",
            "KARAOKE_CPU_INTEROP_THREADS",
            "KARAOKE_CPU_INFERENCE_MODE",
        ):
            os.environ.pop(name, None)

    runtime.configure_runtime("cpu", force=True); out = root / label; out.mkdir(parents=True, exist_ok=True); vocals = out / "vocals.wav"
    instrumental = out / "instrumental.wav"; separator = MSSTMelRoformerSeparator(idle_timeout_sec=1800)
    arguments = {
        "model_type": "mel_band_roformer",
        "config_path": str(Path(separator.config).resolve()),
        "start_check_point": str(Path(separator.checkpoint).resolve()),
        "input_folder": str(root),
        "store_dir": str(out),
    }
    load_started = time.perf_counter(); separator._ensure_worker(arguments); load_sec = time.perf_counter() - load_started; started = time.perf_counter()
    try: separator.separate(mix, vocals, instrumental)
    finally:
        separation_sec = time.perf_counter() - started; separator.close()
    return {
        "label": label,
        "load_sec": load_sec,
        "separation_sec": separation_sec,
        "vocals_sha256": sha256(vocals),
        "instrumental_sha256": sha256(instrumental),
        "vocals": vocals,
        "instrumental": instrumental,
    }


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(
        description="A/B benchmark of the existing CPU Mel-Band RoFormer path."
    )
    parser.add_argument("input", type=Path); parser.add_argument("--seconds", type=float, default=20.0); parser.add_argument("--threads", default="auto"); args = parser.parse_args(argv)

    source = args.input.expanduser().resolve()
    if not source.is_file(): parser.error(f"input file does not exist: {source}")
    if args.seconds <= 0: parser.error("--seconds must be > 0")

    with tempfile.TemporaryDirectory(prefix="advoice-cpu-separation-") as temporary:
        root = Path(temporary); mix = root / "sample.wav"; print(f"Preparing {args.seconds:g}s benchmark sample..."); _convert_input(source, mix, args.seconds)

        print("\n[1/2] CPU baseline"); baseline = _run_profile("baseline", mix, root, tuned=False, threads=args.threads); print(f"      model load: {baseline['load_sec']:.3f}s"); print(f"      separation: {baseline['separation_sec']:.3f}s")

        print(f"\n[2/2] CPU tuned (threads={args.threads}, interop=1, inference_mode=on)"); tuned = _run_profile("tuned", mix, root, tuned=True, threads=args.threads); print(f"      model load: {tuned['load_sec']:.3f}s"); print(f"      separation: {tuned['separation_sec']:.3f}s")

        before = float(baseline["separation_sec"]); after = float(tuned["separation_sec"]); speedup = before / after if after else 0.0; change = 100.0 * (after - before) / before if before else 0.0
        identical = (
            baseline["vocals_sha256"] == tuned["vocals_sha256"]
            and baseline["instrumental_sha256"] == tuned["instrumental_sha256"]
        )
        print("\n============================================================"); print(" RESULT"); print("============================================================"); print(f"Baseline separation : {before:.3f}s")
        print(f"Tuned separation    : {after:.3f}s"); print(f"Change              : {change:+.2f}%"); print(f"Speedup             : {speedup:.3f}x"); print(f"Stems byte-identical: {'YES' if identical else 'NO'}")
        print(f"Vocals baseline     : {baseline['vocals_sha256']}"); print(f"Vocals tuned        : {tuned['vocals_sha256']}"); print(f"Instrumental base   : {baseline['instrumental_sha256']}"); print(f"Instrumental tuned  : {tuned['instrumental_sha256']}")
        if not identical:
            print("\n[STOP] Output changed. Do not enable this tuning in production yet."); return 2
        if after >= before:
            print("\n[STOP] Quality is preserved, but this tuning is not faster on this CPU."); return 3
        print("\n[PASS] Same output and faster CPU separation on this machine."); print("       Use scripts\\start-dev-cpu.bat to run the full app with this tuning."); return 0


if __name__ == "__main__": raise SystemExit(main())
