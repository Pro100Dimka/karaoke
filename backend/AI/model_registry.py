from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

ModelKind = Literal["snapshot", "file", "bundle"]


@dataclass(frozen=True, slots=True)
class ModelFile:
    relative_path: str
    url: str
    sha256: str | None = None
    expected_bytes: int = 0
    min_bytes: int = 1
    contains: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ModelSpec:
    key: str
    name: str
    repo_id: str
    revision: str
    relative_path: str
    env_var: str
    expected_bytes: int = 0
    kind: ModelKind = "snapshot"
    filename: str | None = None
    sha256: str | None = None
    ignore_patterns: tuple[str, ...] = ()
    files: tuple[ModelFile, ...] = ()

    @property
    def local_name(self) -> str:
        return Path(self.relative_path).name


MODELS = (
    ModelSpec("asr", "Qwen3 ASR", "Qwen/Qwen3-ASR-1.7B", "7278e1e70fe206f11671096ffdd38061171dd6e5", "qwen/Qwen3-ASR-1.7B", "KARAOKE_AI_ASR_MODEL", 4_703_114_308),
    ModelSpec("aligner", "Qwen3 Forced Aligner", "Qwen/Qwen3-ForcedAligner-0.6B", "c7cbfc2048c462b0d63a45797104fc9db3ad62b7", "qwen/Qwen3-ForcedAligner-0.6B", "KARAOKE_AI_ALIGNER_MODEL", 1_840_072_459),
    ModelSpec("ctc_ru", "Russian CTC aligner", "jonatasgrosman/wav2vec2-large-xlsr-53-russian", "2329100508896c6d9b157019803ab5601e6f3406", "ctc/wav2vec2-large-xlsr-53-russian", "KARAOKE_AI_CTC_RU_MODEL", 1_265_908_849, ignore_patterns=("language_model/**", "flax_model.msgpack")),
    ModelSpec("ctc_uk", "Ukrainian CTC aligner", "Yehor/wav2vec2-xls-r-300m-uk-with-small-lm", "e3ced4def0d70be3aab0f2db598a59961fe9ab3b", "ctc/wav2vec2-xls-r-300m-uk", "KARAOKE_AI_CTC_UK_MODEL", 1_261_978_306, ignore_patterns=("language_model/**", "flax_model.msgpack")),
    ModelSpec("roformer", "Mel-Band RoFormer", "KimberleyJSN/melbandroformer", "ac9b0614ab3cd7f77219e18ba494dfd93956c348", "roformer", "MSST_CHECKPOINT", 913_106_900, kind="file", filename="MelBandRoformer.ckpt", sha256="87201f4d31afb5bc79993230fc49446918425574db48c01c405e44f365c7559e"),
)
MODEL_BY_KEY = {model.key: model for model in MODELS}


def get_model(key: str) -> ModelSpec:
    return MODEL_BY_KEY[key]


def model_directory(models_root: Path, model: ModelSpec) -> Path:
    return Path(models_root) / model.relative_path


def model_path(models_root: Path, model: ModelSpec) -> Path:
    root = model_directory(models_root, model)
    return root / model.filename if model.kind == "file" and model.filename else root
