from __future__ import annotations

import importlib.util
import multiprocessing
import os
import shutil
import sys
import tempfile
import traceback
from contextlib import suppress
from pathlib import Path
from queue import Empty
from types import ModuleType

import numpy as np
import soundfile as sf

from ..errors import AICoreError, EngineUnavailableError
from .base import Separator


def _run_msst_worker(engine_dir: str, arguments: dict[str, object], result_queue) -> None:
    """Run third-party MSST in an isolated process without a duplicate Python env."""
    engine_path = Path(engine_dir).resolve()
    previous_models = {
        name: module
        for name, module in tuple(sys.modules.items())
        if name == "models" or name.startswith("models.")
    }
    for name in previous_models:
        sys.modules.pop(name, None)

    # MSST has a namespace directory named ``models`` (without __init__.py),
    # while the application has backend/models.py. A regular module wins over
    # a namespace package, so bind the third-party namespace explicitly.
    model_package = ModuleType("models")
    model_package.__package__ = "models"
    model_package.__path__ = [str(engine_path / "models")]
    sys.modules["models"] = model_package
    sys.path.insert(0, str(engine_path))
    try:
        spec = importlib.util.spec_from_file_location("advoice_msst_inference", engine_path / "inference.py")
        if spec is None or spec.loader is None:
            raise RuntimeError("Could not load MSST inference module")
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        module.proc_folder(arguments)
        result_queue.put(None)
    except BaseException:  # The child must report all failures to its parent.
        result_queue.put(traceback.format_exc())
    finally:
        for name in tuple(sys.modules):
            if name == "models" or name.startswith("models."):
                sys.modules.pop(name, None)
        sys.modules.update(previous_models)
        with suppress(ValueError):
            sys.path.remove(str(engine_path))


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
    ):
        self.engine_dir = engine_dir or os.getenv("MSST_ENGINE_DIR")
        self.config = config or os.getenv("MSST_CONFIG")
        self.checkpoint = checkpoint or os.getenv("MSST_CHECKPOINT")

    def available(self) -> bool:
        if not (self.engine_dir and self.config and self.checkpoint):
            return False
        return all(
            path.is_file()
            for path in (
                Path(self.engine_dir) / "inference.py",
                Path(self.config),
                Path(self.checkpoint),
            )
        )

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
        context = multiprocessing.get_context("spawn")
        result_queue = context.Queue(maxsize=1)
        process = context.Process(
            target=_run_msst_worker,
            args=(self.engine_dir, arguments, result_queue),
            daemon=False,
        )
        process.start()
        process.join(timeout=60 * 30)
        if process.is_alive():
            process.terminate()
            process.join(timeout=10)
            raise AICoreError("MSST exceeded the 30-minute safety timeout")
        try:
            error = result_queue.get(timeout=5)
        except Empty:
            error = None
        if process.exitcode != 0 or error:
            raise AICoreError(error or f"MSST process exited with code {process.exitcode}")

    def separate(self, mix, vocals, instrumental):
        if not self.available():
            raise EngineUnavailableError(
                "Mel-Band RoFormer is not configured. Set MSST_ENGINE_DIR, MSST_CONFIG "
                "and MSST_CHECKPOINT to existing files."
            )

        with tempfile.TemporaryDirectory(prefix="karaoke-msst-") as temporary:
            root = Path(temporary)
            input_dir = root / "input"
            output_dir = root / "output"
            input_dir.mkdir()
            output_dir.mkdir()
            shutil.copy2(mix, input_dir / "song.wav")

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
