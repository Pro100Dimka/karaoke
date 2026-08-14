from __future__ import annotations

import importlib.util
import multiprocessing
import os
import shutil
import sys
import tempfile
import time
import traceback
import uuid
from contextlib import suppress
from pathlib import Path
from queue import Empty
from types import ModuleType

import numpy as np
import soundfile as sf

from ..errors import AICoreError, EngineUnavailableError
from ..profiler import profile_operation, record_operation
from ..runtime import selected_backend
from .base import Separator
from .device import accelerator_failure


def _park_model(model, device: str, torch):
    if device == "cpu":
        return model
    model = model.to("cpu")
    if device.startswith("cuda"):
        torch.cuda.empty_cache()
    elif device == "mps":
        torch.mps.empty_cache()
    return model


def _run_persistent_msst_worker(
    engine_dir,
    base_arguments,
    requests,
    results,
    idle_timeout_sec=120.0,
    preferred_device="auto",
) -> None:
    """Load RoFormer once and keep CPU weights alive between isolated jobs."""
    original_stdout, original_stderr = sys.stdout, sys.stderr
    owned_streams = []
    if sys.stdout is None:
        sys.stdout = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115
        owned_streams.append(sys.stdout)
    if sys.stderr is None:
        sys.stderr = open(os.devnull, "w", encoding="utf-8")  # noqa: SIM115
        owned_streams.append(sys.stderr)
    engine_path = Path(engine_dir).resolve()
    previous_models = {
        name: module
        for name, module in tuple(sys.modules.items())
        if name == "models" or name.startswith("models.")
    }
    for name in previous_models:
        sys.modules.pop(name, None)
    package = ModuleType("models")
    package.__package__, package.__path__ = "models", [str(engine_path / "models")]
    sys.modules["models"] = package
    sys.path.insert(0, str(engine_path))
    try:
        spec = importlib.util.spec_from_file_location(
            "advoice_msst_session", engine_path / "inference.py"
        )
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load MSST inference module")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        torch = module.torch
        args = module.parse_args_inference(base_arguments)
        device = "cpu"
        allow_cuda = preferred_device in {"auto", "cuda"}
        allow_mps = preferred_device == "auto"
        if allow_cuda and not args.force_cpu and torch.cuda.is_available():
            device = (
                f"cuda:{args.device_ids[0]}"
                if isinstance(args.device_ids, list)
                else f"cuda:{args.device_ids}"
            )
            torch.backends.cuda.matmul.allow_tf32 = True
            torch.backends.cudnn.allow_tf32 = True
            torch.backends.cudnn.benchmark = True
            torch.set_float32_matmul_precision("high")
        elif allow_mps and not args.force_cpu and torch.backends.mps.is_available():
            device = "mps"
        started = time.perf_counter()
        model, config = module.get_model_from_config(args.model_type, args.config_path)
        if "model_type" in config.training:
            args.model_type = config.training.model_type
        checkpoint = torch.load(args.start_check_point, weights_only=False, map_location="cpu")
        module.load_start_checkpoint(args, model, checkpoint, type_="inference")
        del checkpoint
        model.eval()
        results.put(("ready", time.perf_counter() - started, None))
        while True:
            try:
                request = requests.get(timeout=idle_timeout_sec)
            except Empty:
                break
            if request is None:
                break
            job_id, args.input_folder, args.store_dir = request
            started = time.perf_counter()
            try:
                if device != "cpu":
                    try:
                        model = model.to(device)
                    except Exception as exc:
                        if not device.startswith("cuda") or not accelerator_failure(exc):
                            raise
                        print(
                            "[AI runtime] separation: CUDA model load failed; using CPU",
                            flush=True,
                        )
                        device = "cpu"
                try:
                    module.run_folder(model, args, config, device, verbose=True)
                except Exception as exc:
                    if not device.startswith("cuda") or not accelerator_failure(exc):
                        raise
                    print(
                        "[AI runtime] separation: PyTorch CUDA failed; retrying with CPU",
                        flush=True,
                    )
                    model = _park_model(model, device, torch)
                    device = "cpu"
                    output_dir = Path(args.store_dir)
                    shutil.rmtree(output_dir, ignore_errors=True)
                    output_dir.mkdir(parents=True, exist_ok=True)
                    module.run_folder(model, args, config, device, verbose=True)
                model = _park_model(model, device, torch)
                results.put((job_id, time.perf_counter() - started, None))
            except BaseException:
                with suppress(Exception):
                    model = _park_model(model, device, torch)
                results.put((job_id, time.perf_counter() - started, traceback.format_exc()))
    except BaseException:
        results.put(("ready", 0.0, traceback.format_exc()))
    finally:
        for name in tuple(sys.modules):
            if name == "models" or name.startswith("models."):
                sys.modules.pop(name, None)
        sys.modules.update(previous_models)
        with suppress(ValueError):
            sys.path.remove(str(engine_path))
        sys.stdout, sys.stderr = original_stdout, original_stderr
        for stream in owned_streams:
            stream.close()


def _fit_channels_and_length(audio: np.ndarray, channels: int, frames: int) -> np.ndarray:
    if audio.ndim == 1:
        audio = audio[:, None]
    if audio.shape[1] == 1 and channels == 2:
        audio = np.repeat(audio, 2, axis=1)
    elif audio.shape[1] > channels:
        audio = audio[:, :channels]
    elif audio.shape[1] < channels:
        audio = np.pad(audio, ((0, 0), (0, channels - audio.shape[1])))
    if len(audio) < frames:
        audio = np.pad(audio, ((0, frames - len(audio)), (0, 0)))
    return audio[:frames]


class MSSTMelRoformerSeparator(Separator):
    name = "mel-band-roformer-msst"

    def __init__(
        self,
        engine_dir: str | None = None,
        config: str | None = None,
        checkpoint: str | None = None,
        idle_timeout_sec: float | None = None,
    ):
        self.engine_dir = engine_dir or os.getenv("MSST_ENGINE_DIR")
        self.config = config or os.getenv("MSST_CONFIG")
        self.checkpoint = checkpoint or os.getenv("MSST_CHECKPOINT")
        self.idle_timeout_sec = max(
            30.0,
            float(idle_timeout_sec or os.getenv("KARAOKE_MSST_IDLE_TIMEOUT_SEC", "120")),
        )
        self._process = None
        self._request_queue = None
        self._result_queue = None

    def available(self) -> bool:
        return not self.missing_resources()

    def missing_resources(self) -> list[str]:
        resources = {
            "MSST_ENGINE_DIR/inference.py": (
                Path(self.engine_dir) / "inference.py" if self.engine_dir else None
            ),
            "MSST_CONFIG": Path(self.config) if self.config else None,
            "MSST_CHECKPOINT": Path(self.checkpoint) if self.checkpoint else None,
        }
        return [
            f"{name}={path if path is not None else '<not configured>'}"
            for name, path in resources.items()
            if path is None or not path.is_file()
        ]

    def _run_engine(self, input_dir: Path, output_dir: Path) -> None:
        if not self.engine_dir or not self.config or not self.checkpoint:
            raise EngineUnavailableError("Mel-Band RoFormer resources are not configured")
        arguments = {
            "model_type": "mel_band_roformer",
            "config_path": str(Path(self.config).resolve()),
            "start_check_point": str(Path(self.checkpoint).resolve()),
            "input_folder": str(input_dir),
            "store_dir": str(output_dir),
        }
        self._ensure_worker(arguments)
        process = self._process
        job_id = uuid.uuid4().hex
        self._request_queue.put((job_id, str(input_dir), str(output_dir)))
        started_at = time.monotonic()
        while process.is_alive() and time.monotonic() - started_at < 60 * 30:
            try:
                response_id, elapsed_sec, error = self._result_queue.get(timeout=10)
            except Empty:
                elapsed = int(time.monotonic() - started_at)
                print(f"[MSST] separation is active · {elapsed}s elapsed", flush=True)
                continue
            if response_id != job_id:
                continue
            record_operation("separation.inference", elapsed_sec=elapsed_sec)
            if error:
                raise AICoreError(error)
            return
        exitcode = process.exitcode
        timed_out = time.monotonic() - started_at >= 60 * 30
        self.close()
        if timed_out:
            raise AICoreError("MSST exceeded the 30-minute safety timeout")
        raise AICoreError(f"MSST process exited with code {exitcode}")

    def _ensure_worker(self, arguments: dict[str, object]) -> None:
        if self._process is not None and self._process.is_alive():
            return
        self.close()
        context = multiprocessing.get_context("spawn")
        self._request_queue = context.Queue(maxsize=1)
        self._result_queue = context.Queue(maxsize=1)
        backend = selected_backend("separation")
        preferred_device = backend.device if backend is not None else "cpu"
        self._process = context.Process(
            target=_run_persistent_msst_worker,
            args=(
                self.engine_dir,
                arguments,
                self._request_queue,
                self._result_queue,
                self.idle_timeout_sec,
                preferred_device,
            ),
            daemon=True,
        )
        self._process.start()
        try:
            response, elapsed_sec, error = self._result_queue.get(timeout=5 * 60)
        except Empty as exc:
            self.close()
            raise AICoreError("MSST model initialization exceeded 5 minutes") from exc
        if response != "ready" or error:
            self.close()
            raise AICoreError(error or "MSST worker returned an invalid ready response")
        record_operation("model.load.roformer", elapsed_sec=elapsed_sec)

    def close(self) -> None:
        process, requests = self._process, self._request_queue
        self._process = self._request_queue = self._result_queue = None
        if process is None:
            return
        if process.is_alive():
            with suppress(Exception):
                requests.put_nowait(None)
            process.join(timeout=10)
        if process.is_alive():
            process.terminate()
            process.join(timeout=10)

    def separate(self, mix, vocals, instrumental):
        if not self.available():
            raise EngineUnavailableError(
                "Mel-Band RoFormer resources are missing: " + "; ".join(self.missing_resources())
            )

        with tempfile.TemporaryDirectory(
            prefix=".karaoke-msst-", dir=Path(mix).parent
        ) as temporary:
            root = Path(temporary)
            input_dir = root / "input"
            output_dir = root / "output"
            input_dir.mkdir()
            output_dir.mkdir()
            linked_mix = input_dir / "song.wav"
            try:
                os.link(mix, linked_mix)
                record_operation("separation.input_hardlink")
            except OSError:
                with profile_operation(
                    "separation.input_copy", byte_count=Path(mix).stat().st_size
                ):
                    shutil.copy2(mix, linked_mix)

            self._run_engine(input_dir, output_dir)

            all_wavs = sorted(output_dir.rglob("*.wav"))
            vocal_candidates = [
                path
                for path in all_wavs
                if "vocal" in path.name.lower()
                and "no_vocal" not in path.name.lower()
                and "instrumental" not in path.name.lower()
            ]
            instrumental_candidates = [
                path
                for path in all_wavs
                if "instrumental" in path.name.lower() or "no_vocal" in path.name.lower()
            ]
            if not vocal_candidates:
                raise AICoreError("MSST did not produce a vocals stem")

            mix_audio, sample_rate = sf.read(mix, dtype="float32", always_2d=True)
            vocal_audio, vocal_rate = sf.read(vocal_candidates[0], dtype="float32", always_2d=True)
            if sample_rate != vocal_rate:
                raise AICoreError("MSST vocals sample-rate mismatch")
            vocal_audio = _fit_channels_and_length(vocal_audio, mix_audio.shape[1], len(mix_audio))

            if instrumental_candidates:
                instrumental_audio, instrumental_rate = sf.read(
                    instrumental_candidates[0], dtype="float32", always_2d=True
                )
                if instrumental_rate != sample_rate:
                    raise AICoreError("MSST instrumental sample-rate mismatch")
                instrumental_audio = _fit_channels_and_length(
                    instrumental_audio, mix_audio.shape[1], len(mix_audio)
                )
            else:
                instrumental_audio = mix_audio - vocal_audio

            vocals.parent.mkdir(parents=True, exist_ok=True)
            instrumental.parent.mkdir(parents=True, exist_ok=True)
            sf.write(vocals, np.clip(vocal_audio, -1, 1), sample_rate, subtype="PCM_24")
            sf.write(
                instrumental,
                np.clip(instrumental_audio, -1, 1),
                sample_rate,
                subtype="PCM_24",
            )


class CenterChannelFallbackSeparator(Separator):
    name = "center-channel-fallback"

    def separate(self, mix, vocals, instrumental):
        audio, sample_rate = sf.read(mix, dtype="float32", always_2d=True)
        if audio.shape[1] == 1:
            vocal = audio.copy()
            inst = np.zeros_like(audio)
        else:
            mid = np.mean(audio[:, :2], axis=1, keepdims=True)
            vocal = np.repeat(mid, 2, axis=1)
            inst = audio[:, :2] - vocal
        vocals.parent.mkdir(parents=True, exist_ok=True)
        instrumental.parent.mkdir(parents=True, exist_ok=True)
        sf.write(vocals, np.clip(vocal, -1, 1), sample_rate, subtype="PCM_24")
        sf.write(instrumental, np.clip(inst, -1, 1), sample_rate, subtype="PCM_24")
