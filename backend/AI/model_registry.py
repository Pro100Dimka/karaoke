from __future__ import annotations

from dataclasses import dataclass
from pathlib import Path
from typing import Literal

ModelKind = Literal["snapshot", "file", "bundle"]


@dataclass(frozen=True, slots=True)
class ModelFile: relative_path: str; url: str; sha256: str | None = None; expected_bytes: int = 0; min_bytes: int = 1; contains: tuple[str, ...] = ()


@dataclass(frozen=True, slots=True)
class ModelSpec:
    key: str
    name: str
    repo_id: str
    revision: str
    relative_path: str
    env_var: str
    kind: ModelKind = "snapshot"
    filename: str | None = None
    sha256: str | None = None
    ignore_patterns: tuple[str, ...] = ()
    expected_bytes: int = 0
    files: tuple[ModelFile, ...] = ()

    @property
    def local_name(self) -> str: return Path(self.relative_path).name


def _model(key, name, repo_id, revision, relative_path, env_var, expected_bytes, **extra): return ModelSpec(key, name, repo_id, revision, relative_path, env_var, expected_bytes=expected_bytes, **extra)


def _file(relative_path, url, sha256=None, expected_bytes=0, **extra): return ModelFile(relative_path, url, sha256, expected_bytes, **extra)


MODELS: tuple[ModelSpec, ...] = (
    _model("asr", "Qwen3 ASR", "Qwen/Qwen3-ASR-1.7B", "7278e1e70fe206f11671096ffdd38061171dd6e5", "qwen/Qwen3-ASR-1.7B", "KARAOKE_AI_ASR_MODEL", 4_703_114_308),
    _model("aligner", "Qwen3 Forced Aligner", "Qwen/Qwen3-ForcedAligner-0.6B", "c7cbfc2048c462b0d63a45797104fc9db3ad62b7", "qwen/Qwen3-ForcedAligner-0.6B", "KARAOKE_AI_ALIGNER_MODEL", 1_840_072_459),
    _model("ctc_ru", "Russian CTC aligner", "jonatasgrosman/wav2vec2-large-xlsr-53-russian", "2329100508896c6d9b157019803ab5601e6f3406", "ctc/wav2vec2-large-xlsr-53-russian", "KARAOKE_AI_CTC_RU_MODEL", 1_265_908_849, ignore_patterns=("language_model/**", "flax_model.msgpack")),
    _model("ctc_uk", "Ukrainian CTC aligner", "Yehor/wav2vec2-xls-r-300m-uk-with-small-lm", "e3ced4def0d70be3aab0f2db598a59961fe9ab3b", "ctc/wav2vec2-xls-r-300m-uk", "KARAOKE_AI_CTC_UK_MODEL", 1_261_978_306, ignore_patterns=("language_model/**", "flax_model.msgpack")),
    _model("roformer", "Mel-Band RoFormer", "KimberleyJSN/melbandroformer", "ac9b0614ab3cd7f77219e18ba494dfd93956c348", "roformer", "MSST_CHECKPOINT", 913_106_900, kind="file", filename="MelBandRoformer.ckpt", sha256="87201f4d31afb5bc79993230fc49446918425574db48c01c405e44f365c7559e"),
    _model(
        "omnizart_patch_cnn", "Omnizart Patch-CNN Vocal Melody", "Music-and-Culture-Technology-Lab/omnizart",
        "bcd8cb44d4da66ce87df10b6abee5c35a8cc2886", "omnizart/patch_cnn_melody", "KARAOKE_AI_OMNIZART_MODEL", 868_365, kind="bundle",
        files=(
            _file("configurations.yaml", "https://raw.githubusercontent.com/Music-and-Culture-Technology-Lab/omnizart/bcd8cb44d4da66ce87df10b6abee5c35a8cc2886/omnizart/checkpoints/patch_cnn/patch_cnn_melody/configurations.yaml", min_bytes=1_000, contains=("TranscriptionMode:", "Value: Melody", "PatchSize:", "SamplingRate:")),
            _file("saved_model.pb", "https://raw.githubusercontent.com/Music-and-Culture-Technology-Lab/omnizart/bcd8cb44d4da66ce87df10b6abee5c35a8cc2886/omnizart/checkpoints/patch_cnn/patch_cnn_melody/saved_model.pb", "78a90299f4b24484dbf4638df16f4bc25af3f2f2b36d37b5197f7de72525f720", 155_120),
            _file("variables/variables.index", "https://raw.githubusercontent.com/Music-and-Culture-Technology-Lab/omnizart/bcd8cb44d4da66ce87df10b6abee5c35a8cc2886/omnizart/checkpoints/patch_cnn/patch_cnn_melody/variables/variables.index", "8d8eb8b6726e36c530917a5daaa771d42a8efe378b6fa84f6f048fdd986a0ac7", 760),
            _file("variables/variables.data-00000-of-00001", "https://github.com/Music-and-Culture-Technology-Lab/omnizart/releases/download/checkpoints-20211001/patch_cnn_melody@variables.data-00000-of-00001", "bbbd11fc0b60a5f3986c39f7bb3985205d719031f70f916edc560f8b4d01b51a", 708_098),
        ),
    ),
)

MODEL_BY_KEY = {model.key: model for model in MODELS}


def get_model(key: str) -> ModelSpec: return MODEL_BY_KEY[key]


def model_directory(models_root: Path, model: ModelSpec) -> Path: return models_root / model.relative_path


def model_path(models_root: Path, model: ModelSpec) -> Path: directory = model_directory(models_root, model); return directory / model.filename if model.kind == "file" and model.filename else directory
