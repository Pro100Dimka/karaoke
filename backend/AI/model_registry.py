from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

ModelKind = Literal["snapshot", "file"]


@dataclass(frozen=True, slots=True)
class ModelSpec:
    key: str
    name: str
    repo_id: str
    relative_path: str
    env_var: str
    kind: ModelKind = "snapshot"
    filename: str | None = None
    sha256: str | None = None

    @property
    def local_name(self) -> str:
        return Path(self.relative_path).name


MODELS: tuple[ModelSpec, ...] = (
    ModelSpec(
        key="asr",
        name="Qwen3 ASR",
        repo_id="Qwen/Qwen3-ASR-1.7B",
        relative_path="qwen/Qwen3-ASR-1.7B",
        env_var="KARAOKE_AI_ASR_MODEL",
    ),
    ModelSpec(
        key="aligner",
        name="Qwen3 Forced Aligner",
        repo_id="Qwen/Qwen3-ForcedAligner-0.6B",
        relative_path="qwen/Qwen3-ForcedAligner-0.6B",
        env_var="KARAOKE_AI_ALIGNER_MODEL",
    ),
    ModelSpec(
        key="ctc_ru",
        name="Russian CTC aligner",
        repo_id="jonatasgrosman/wav2vec2-large-xlsr-53-russian",
        relative_path="ctc/wav2vec2-large-xlsr-53-russian",
        env_var="KARAOKE_AI_CTC_RU_MODEL",
    ),
    ModelSpec(
        key="ctc_uk",
        name="Ukrainian CTC aligner",
        repo_id="Yehor/wav2vec2-xls-r-300m-uk-with-small-lm",
        relative_path="ctc/wav2vec2-xls-r-300m-uk",
        env_var="KARAOKE_AI_CTC_UK_MODEL",
    ),
    ModelSpec(
        key="roformer",
        name="Mel-Band RoFormer",
        repo_id="KimberleyJSN/melbandroformer",
        relative_path="roformer",
        env_var="MSST_CHECKPOINT",
        kind="file",
        filename="MelBandRoformer.ckpt",
        sha256="87201f4d31afb5bc79993230fc49446918425574db48c01c405e44f365c7559e",
    ),
)

MODEL_BY_KEY = {model.key: model for model in MODELS}


def get_model(key: str) -> ModelSpec:
    return MODEL_BY_KEY[key]


def model_directory(models_root: Path, model: ModelSpec) -> Path:
    return models_root / model.relative_path


def model_path(models_root: Path, model: ModelSpec) -> Path:
    directory = model_directory(models_root, model)
    return directory / model.filename if model.kind == "file" and model.filename else directory
