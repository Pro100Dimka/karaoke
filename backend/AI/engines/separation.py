from __future__ import annotations

import multiprocessing
import os
import shutil
import sys
import tempfile
import time
from pathlib import Path
from queue import Empty
from types import ModuleType

import numpy as np
import soundfile as sf

from ..errors import AICoreError, EngineUnavailableError
from .base import Separator


def _worker(engine_dir, config_path, checkpoint, requests, results, device):
    sys.path.insert(0, engine_dir)
    try:
        engine_root = Path(engine_dir).resolve()
        for name, module in tuple(sys.modules.items()):
            if name.split(".", 1)[0] not in {"models", "utils"}:
                continue
            module_file = getattr(module, "__file__", None)
            if not module_file or engine_root not in Path(module_file).resolve().parents:
                sys.modules.pop(name, None)
        for name in ("models", "utils"):
            package = ModuleType(name)
            package.__path__ = [str(engine_root / name)]
            package.__package__ = name
            sys.modules[name] = package
        import torch
        from inference import run_folder
        from utils.model_utils import load_start_checkpoint
        from utils.settings import get_model_from_config, parse_args_inference

        arguments = parse_args_inference({
            "model_type": "mel_band_roformer",
            "config_path": config_path,
            "start_check_point": checkpoint,
            "force_cpu": device == "cpu",
            "disable_detailed_pbar": True,
        })
        model, config = get_model_from_config(arguments.model_type, arguments.config_path)
        weights = torch.load(checkpoint, weights_only=False, map_location="cpu")
        load_start_checkpoint(arguments, model, weights, type_="inference")
        model = model.to(device)
        results.put(("ready", None))
        while request := requests.get():
            job, input_dir, output_dir, tuning = request
            started = time.perf_counter()
            try:
                arguments.input_folder, arguments.store_dir = input_dir, output_dir
                for key, value in tuning.items():
                    setattr(config.inference, key, value)
                run_folder(model, arguments, config, device, verbose=True)
                results.put((job, time.perf_counter() - started))
            except BaseException as error:
                results.put((job, f"{type(error).__name__}: {error}"))
    except BaseException as error:
        results.put(("boot-error", f"{type(error).__name__}: {error}"))


def _fit(audio: np.ndarray, frames: int, channels: int) -> np.ndarray:
    audio = audio[:, None] if audio.ndim == 1 else audio
    if audio.shape[1] == 1 and channels == 2:
        audio = np.repeat(audio, 2, axis=1)
    audio = np.pad(audio[:, :channels], ((0, max(0, frames - len(audio))), (0, max(0, channels - audio.shape[1]))))
    return audio[:frames, :channels]


class MSSTMelRoformerSeparator(Separator):
    name = "mel-band-roformer-msst"

    def __init__(self, engine_dir=None, config=None, checkpoint=None, **_options):
        self.engine_dir = Path(engine_dir or os.getenv("MSST_ENGINE_DIR", ""))
        self.config = Path(config or os.getenv("MSST_CONFIG", ""))
        self.checkpoint = Path(checkpoint or os.getenv("MSST_CHECKPOINT", ""))
        self._process = self._requests = self._results = None
        self._device = None

    def missing_resources(self) -> list[str]:
        resources = (
            ("MSST_ENGINE_DIR/inference.py", self.engine_dir / "inference.py"),
            ("MSST_CONFIG", self.config),
            ("MSST_CHECKPOINT", self.checkpoint),
        )
        return [f"{name}={path if str(path) not in {'', '.'} else '<not configured>'}" for name, path in resources if not path.is_file()]

    def available(self) -> bool:
        return not self.missing_resources()

    def separate(self, mix, vocals, instrumental, *, profile=None):
        if missing := self.missing_resources():
            raise EngineUnavailableError("Missing MSST resources: " + ", ".join(missing))
        with tempfile.TemporaryDirectory(prefix="karaoke-msst-", dir=Path(mix).parent) as temporary:
            source, output = Path(temporary) / "input", Path(temporary) / "output"
            source.mkdir()
            output.mkdir()
            shutil.copy2(mix, source / "song.wav")
            tuning = {
                "num_overlap": profile.separation_overlap,
                "batch_size": profile.separation_batch_size,
            } if profile else {}
            try:
                self._run(source, output, tuning)
            except AICoreError as error:
                if not any(marker in str(error).lower() for marker in ("cuda", "cudnn", "accelerator")):
                    raise
                print(f"[MSST] accelerator failed, retrying on CPU: {error}", flush=True)
                self.close()
                output = Path(temporary) / "output-cpu"
                output.mkdir()
                self._run(source, output, tuning, device="cpu")
            files = list(output.rglob("*.wav"))
            vocal = next((item for item in files if "vocal" in item.name.lower() and "no_vocal" not in item.name.lower()), None)
            backing = next((item for item in files if any(name in item.name.lower() for name in ("instrumental", "no_vocal"))), None)
            if vocal is None:
                raise AICoreError("MSST produced no vocal stem")
            mix_audio, rate = sf.read(mix, dtype="float32", always_2d=True)
            vocal_audio, vocal_rate = sf.read(vocal, dtype="float32", always_2d=True)
            if vocal_rate != rate:
                raise AICoreError("MSST sample-rate mismatch")
            vocal_audio = _fit(vocal_audio, len(mix_audio), mix_audio.shape[1])
            backing_audio = _fit(sf.read(backing, dtype="float32", always_2d=True)[0], len(mix_audio), mix_audio.shape[1]) if backing else mix_audio - vocal_audio
            sf.write(vocals, np.clip(vocal_audio, -1, 1), rate, subtype="PCM_24")
            sf.write(instrumental, np.clip(backing_audio, -1, 1), rate, subtype="PCM_24")

    def close(self) -> None:
        process, requests = self._process, self._requests
        self._process = self._requests = self._results = None
        self._device = None
        if process and process.is_alive():
            requests.put(None)
            process.join(timeout=10)
        if process and process.is_alive():
            process.terminate()

    def _run(self, source, output, tuning, device=None):
        self._ensure_worker(device)
        job = os.urandom(8).hex()
        self._requests.put((job, str(source), str(output), tuning))
        while self._process.is_alive():
            try:
                response, value = self._results.get(timeout=10)
            except Empty:
                print("[MSST] separation is active", flush=True)
                continue
            if response != job:
                continue
            if isinstance(value, str):
                raise AICoreError(value)
            return
        raise AICoreError(f"MSST worker exited with {self._process.exitcode}")

    def _ensure_worker(self, device=None):
        if self._process and self._process.is_alive() and (device is None or device == self._device):
            return
        self.close()
        context = multiprocessing.get_context("spawn")
        self._requests, self._results = context.Queue(1), context.Queue(1)
        from ..runtime import selected_backend
        backend = selected_backend("separation")
        device = device or (backend.device if backend else "cpu")
        self._device = device
        self._process = context.Process(
            target=_worker,
            args=(str(self.engine_dir), str(self.config), str(self.checkpoint), self._requests, self._results, device),
            daemon=True,
        )
        self._process.start()
        try:
            status, detail = self._results.get(timeout=300)
        except Empty as error:
            self.close()
            raise AICoreError("MSST initialization timed out") from error
        if status != "ready":
            self.close()
            raise AICoreError(detail or "MSST initialization failed")


class CenterChannelFallbackSeparator(Separator):
    name = "center-channel-fallback"

    def separate(self, mix, vocals, instrumental, *, profile=None):
        audio, rate = sf.read(mix, dtype="float32", always_2d=True)
        center = np.mean(audio[:, :2], axis=1, keepdims=True)
        vocal = np.repeat(center, audio.shape[1], axis=1)
        sf.write(vocals, vocal, rate, subtype="PCM_24")
        sf.write(instrumental, audio - vocal, rate, subtype="PCM_24")
