from __future__ import annotations

import os
from pathlib import Path
import shlex
import shutil
import subprocess
import tempfile

import numpy as np
import soundfile as sf

from .base import Separator
from ..errors import AICoreError, EngineUnavailableError


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
        command: str | None = None,
        config: str | None = None,
        checkpoint: str | None = None,
    ):
        self.command = command or os.getenv("MSST_INFERENCE_COMMAND")
        self.config = config or os.getenv("MSST_CONFIG")
        self.checkpoint = checkpoint or os.getenv("MSST_CHECKPOINT")

    def available(self) -> bool:
        if not (self.command and self.config and self.checkpoint):
            return False
        if not (Path(self.config).is_file() and Path(self.checkpoint).is_file()):
            return False
        try:
            command = shlex.split(self.command, posix=True)
        except ValueError:
            return False
        if not command:
            return False
        executable = Path(command[0])
        if not executable.is_file():
            return False
        if len(command) > 1 and command[1].lower().endswith((".py", ".pyw")):
            if not Path(command[1]).is_file():
                return False
        return True

    def _build_command(self, input_dir: Path, output_dir: Path) -> list[str]:
        if not self.command:
            raise EngineUnavailableError("MSST_INFERENCE_COMMAND is not configured")
        command = shlex.split(self.command, posix=True)
        command.extend(
            [
                "--model_type",
                "mel_band_roformer",
                "--config_path",
                str(Path(self.config).resolve()),
                "--start_check_point",
                str(Path(self.checkpoint).resolve()),
                "--input_folder",
                str(input_dir),
                "--store_dir",
                str(output_dir),
            ]
        )
        return command

    def separate(self, mix, vocals, instrumental):
        if not self.available():
            raise EngineUnavailableError(
                "Mel-Band RoFormer is not configured. Set MSST_INFERENCE_COMMAND, "
                "MSST_CONFIG and MSST_CHECKPOINT to existing files."
            )

        with tempfile.TemporaryDirectory(prefix="karaoke-msst-") as temporary:
            root = Path(temporary)
            input_dir = root / "input"
            output_dir = root / "output"
            input_dir.mkdir()
            output_dir.mkdir()
            shutil.copy2(mix, input_dir / "song.wav")

            try:
                completed = subprocess.run(
                    self._build_command(input_dir, output_dir),
                    check=True,
                    capture_output=True,
                    text=True,
                    encoding="utf-8",
                    errors="replace",
                    timeout=60 * 30,
                )
            except FileNotFoundError as exc:
                command = self._build_command(input_dir, output_dir)
                raise EngineUnavailableError(
                    "MSST inference command could not be started. "
                    f"Executable: {command[0]!r}"
                ) from exc
            except subprocess.TimeoutExpired as exc:
                raise AICoreError("MSST exceeded the 30-minute safety timeout") from exc
            except subprocess.CalledProcessError as exc:
                details = (exc.stderr or exc.stdout or "MSST failed").strip()
                raise AICoreError(details) from exc

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
                if "instrumental" in path.name.lower()
                or "no_vocal" in path.name.lower()
            ]
            if not vocal_candidates:
                tail = (completed.stdout or "")[-2000:]
                raise AICoreError(f"MSST did not produce a vocals stem. Output: {tail}")

            mix_audio, sample_rate = sf.read(mix, dtype="float32", always_2d=True)
            vocal_audio, vocal_rate = sf.read(
                vocal_candidates[0], dtype="float32", always_2d=True
            )
            if sample_rate != vocal_rate:
                raise AICoreError("MSST vocals sample-rate mismatch")
            vocal_audio = _fit_channels_and_length(
                vocal_audio, mix_audio.shape[1], len(mix_audio)
            )

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
