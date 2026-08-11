from __future__ import annotations

import argparse
import hashlib
import os
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path

from huggingface_hub import hf_hub_download, snapshot_download

from AI.model_registry import MODELS, ModelSpec, model_directory, model_path


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest().lower()


def _has_weights(path: Path) -> bool:
    return any(path.rglob("*.safetensors")) or any(path.rglob("pytorch_model.bin"))


def is_valid(models_root: Path, model: ModelSpec) -> bool:
    if model.kind == "file":
        path = model_path(models_root, model)
        if not path.is_file():
            return False
        return not model.sha256 or _sha256(path) == model.sha256.lower()

    directory = model_directory(models_root, model)
    return (directory / "config.json").is_file() and _has_weights(directory)


def install_one(models_root: Path, model: ModelSpec) -> tuple[str, str]:
    if is_valid(models_root, model):
        return model.name, "ready"

    directory = model_directory(models_root, model)
    directory.mkdir(parents=True, exist_ok=True)

    print(f"[DOWNLOAD] {model.name}: {model.repo_id}", flush=True)

    if model.kind == "file":
        if not model.filename:
            raise RuntimeError(f"{model.name}: filename is missing in model registry")
        hf_hub_download(
            repo_id=model.repo_id,
            filename=model.filename,
            local_dir=str(directory),
        )
    else:
        snapshot_download(
            repo_id=model.repo_id,
            local_dir=str(directory),
        )

    if not is_valid(models_root, model):
        raise RuntimeError(f"{model.name}: verification failed after download")

    return model.name, "downloaded"


def write_environment(downloads: Path, models_root: Path, msst: Path, env_file: Path) -> None:
    values = {
        "HF_HOME": downloads / "cache" / "huggingface",
        "HF_HUB_CACHE": downloads / "cache" / "huggingface" / "hub",
        "KARAOKE_AI_ALLOW_FALLBACK": "false",
        "KARAOKE_AI_REQUIRE_CTC": "1",
        "MSST_ENGINE_DIR": msst,
        "MSST_CONFIG": msst / "configs" / "KimberleyJensen" / "config_vocals_mel_band_roformer_kj.yaml",
    }
    for model in MODELS:
        values[model.env_var] = model_path(models_root, model)

    env_file.parent.mkdir(parents=True, exist_ok=True)
    with env_file.open("w", encoding="utf-8", newline="\r\n") as handle:
        handle.write("@echo off\r\n")
        for name, value in values.items():
            handle.write(f'set "{name}={value}"\r\n')


def verify_all(models_root: Path) -> bool:
    ok = True
    for model in MODELS:
        valid = is_valid(models_root, model)
        print(f"[{'OK' if valid else 'MISSING'}] {model.name}")
        ok = ok and valid
    return ok


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--downloads", required=True, type=Path)
    parser.add_argument("--msst", required=True, type=Path)
    parser.add_argument("--env", required=True, type=Path)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()

    downloads = args.downloads.resolve()
    models_root = downloads / "models"
    msst = args.msst.resolve()
    env_file = args.env.resolve()
    models_root.mkdir(parents=True, exist_ok=True)

    os.environ.setdefault("HF_HOME", str(downloads / "cache" / "huggingface"))
    os.environ.setdefault("HF_HUB_CACHE", str(downloads / "cache" / "huggingface" / "hub"))
    os.environ.setdefault("HF_HUB_DISABLE_TELEMETRY", "1")

    if args.check:
        ok = verify_all(models_root)
        if ok:
            write_environment(downloads, models_root, msst, env_file)
        return 0 if ok else 1

    workers = max(1, min(args.workers, len(MODELS)))
    print(f"Installing {len(MODELS)} model resources with {workers} parallel workers...")

    failed = False
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="ai-model") as pool:
        futures = {pool.submit(install_one, models_root, model): model for model in MODELS}
        for future in as_completed(futures):
            model = futures[future]
            try:
                name, status = future.result()
                print(f"[{'SKIP' if status == 'ready' else 'DONE'}] {name}", flush=True)
            except Exception as exc:
                failed = True
                print(f"[ERROR] {model.name}: {exc}", flush=True)

    if failed or not verify_all(models_root):
        return 1

    write_environment(downloads, models_root, msst, env_file)
    print("All registered AI models are ready.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
