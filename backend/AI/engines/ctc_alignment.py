from __future__ import annotations

import os
import re
import sys
from contextlib import suppress
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..audio import load_mono
from ..backend_shadow import ShadowPolicy
from ..errors import EngineUnavailableError, InvalidArtifactError
from ..model_registry import get_model
from ..models import Word
from ..profiler import profile_operation
from .ctc_backends import (
    OrtCudaCTCBackend,
    PyTorchCTCBackend,
    describe_inference,
)
from .device import fallback_torch_device, select_torch_device

_CLEAN = re.compile(r"[^\w]+", re.UNICODE)

CTC_ALIGNMENT_VERSION = "v3-song-relative-window-local-retry"


@dataclass(frozen=True, slots=True)
class CTCLineResult:
    words: tuple[Word, ...]
    confidence: float
    window_start: float
    window_end: float


def _language_code(language: str | None, text: str = "") -> str:
    value = str(language or "").strip().casefold()
    if value.startswith(("ru", "russian")):
        return "ru"
    if value.startswith(("uk", "ua", "ukrainian")):
        return "uk"
    if value.startswith(("en", "english")):
        return "en"
    sample = str(text or "").casefold()
    if any(ch in sample for ch in "іїєґ"):
        return "uk"
    if re.search(r"[а-яё]", sample):
        return "ru"
    if re.search(r"[a-z]", sample):
        return "en"
    return ""


def _expected_duration(tokens: list[str]) -> float:
    if not tokens:
        return 0.5
    chars = sum(max(1, len(token)) for token in tokens)
    # Singing is slower than conversational speech. This is only a search-window
    # prior; final boundaries always come from the acoustic CTC path.
    return max(0.25, 0.28 * len(tokens) + 0.055 * chars)


def _normalize_word(word: str) -> str:
    value = _CLEAN.sub("", str(word).casefold())
    return value.replace("ё", "е")


def _ctc_viterbi_states(log_probs, target_ids: list[int], blank_id: int):
    """Return expanded CTC state index for every emission frame.

    The state graph is ``blank, t0, blank, t1, ...``. A two-state skip is only
    allowed when entering a non-blank label that differs from the previous label,
    matching the CTC collapse rule. This keeps repeated letters correctly separated.
    """
    import torch

    if log_probs.ndim != 2:
        raise ValueError("CTC emissions must have shape [frames, labels]")
    frames, _labels = log_probs.shape
    if not target_ids or frames <= 0:
        raise ValueError("CTC alignment requires non-empty targets and emissions")

    target = torch.tensor(target_ids, dtype=torch.long, device=log_probs.device)
    states = torch.full(
        (2 * len(target_ids) + 1,), int(blank_id), dtype=torch.long, device=log_probs.device
    )
    states[1::2] = target
    count = int(states.numel())
    neg = torch.finfo(log_probs.dtype).min

    previous = torch.full((count,), neg, dtype=log_probs.dtype, device=log_probs.device)
    previous[0] = log_probs[0, blank_id]
    if count > 1:
        previous[1] = log_probs[0, target_ids[0]]
    back = torch.zeros((frames, count), dtype=torch.int8, device="cpu")

    can_skip = torch.zeros((count,), dtype=torch.bool, device=log_probs.device)
    if count > 3:
        odd = torch.arange(3, count, 2, device=log_probs.device)
        can_skip[odd] = states[odd] != states[odd - 2]

    for frame in range(1, frames):
        stay = previous
        step = torch.full_like(previous, neg)
        step[1:] = previous[:-1]
        skip = torch.full_like(previous, neg)
        skip[2:] = previous[:-2]
        skip = torch.where(can_skip, skip, torch.full_like(skip, neg))
        candidates = torch.stack((stay, step, skip), dim=0)
        best_values, transition = torch.max(candidates, dim=0)
        current = best_values + log_probs[frame, states]
        back[frame] = transition.to("cpu", dtype=torch.int8)
        previous = current

    last_states = torch.tensor([count - 1, count - 2], device=log_probs.device)
    state = int(last_states[torch.argmax(previous[last_states])].item())

    path = [0] * frames
    path[-1] = state
    for frame in range(frames - 1, 0, -1):
        transition = int(back[frame, state].item())
        state -= transition
        path[frame - 1] = state
    return path, states.detach().cpu().tolist()


def _word_spans_from_ctc(
    log_probs,
    target_ids: list[int],
    word_target_positions: list[list[int]],
    blank_id: int,
    words: list[str],
    duration_sec: float,
) -> tuple[list[Word], float]:
    import torch

    path, _state_labels = _ctc_viterbi_states(log_probs, target_ids, blank_id)
    frame_count = len(path)
    if duration_sec <= 0:
        return [], 0.0

    frames_for_target: list[list[int]] = [[] for _ in target_ids]
    token_scores: list[list[float]] = [[] for _ in target_ids]
    for frame, state in enumerate(path):
        if state % 2 == 0:
            continue
        target_pos = (state - 1) // 2
        if 0 <= target_pos < len(target_ids):
            frames_for_target[target_pos].append(frame)
            label = target_ids[target_pos]
            token_scores[target_pos].append(
                float(torch.exp(log_probs[frame, label]).clamp(0, 1).item())
            )

    result: list[Word] = []
    all_scores: list[float] = []
    previous_end = 0.0
    for index, (word, target_positions) in enumerate(
        zip(words, word_target_positions, strict=True)
    ):
        frame_ids = [frame for pos in target_positions for frame in frames_for_target[pos]]
        scores = [score for pos in target_positions for score in token_scores[pos]]
        if not frame_ids:
            return [], 0.0
        start = duration_sec * min(frame_ids) / frame_count
        end = duration_sec * (max(frame_ids) + 1) / frame_count
        start = max(previous_end, start)
        end = max(start + min(0.02, duration_sec / frame_count), end)
        confidence = float(sum(scores) / max(1, len(scores)))
        result.append(Word(start, end, word, confidence, index))
        previous_end = end
        all_scores.extend(scores)
    return result, float(sum(all_scores) / max(1, len(all_scores)))


def _word_values(words: list[Word]) -> list[dict[str, float | str]]:
    """Serialize aligned words for shadow-comparison diagnostics."""
    return [
        {"text": word.text, "start": word.start, "end": word.end, "confidence": word.confidence}
        for word in words
    ]


class CTCWordAligner:
    """Multilingual acoustic word aligner for trusted lyrics.

    It uses a language-specific Wav2Vec2 CTC acoustic model and character-level
    Viterbi alignment. Unlike ASR anchors, the canonical lyric text is the target
    sequence itself, so recognized text can never replace or delete lyrics.
    """

    MODEL_DIR_NAMES = {
        "ru": get_model("ctc_ru").local_name,
        "uk": get_model("ctc_uk").local_name,
    }

    def __init__(
        self,
        models: dict[str, str] | None = None,
        *,
        shadow_policy: ShadowPolicy | None = None,
        shadow_backend_factory=OrtCudaCTCBackend,
    ):
        self.models = dict(models or {})
        self._processor = None
        self._model = None
        self._loaded_key = ""
        self._device = "cpu"
        self.last_resource_diagnostics: dict[str, object] = {}
        self.last_alignment_diagnostics: dict[str, object] = {}
        self.last_shadow_diagnostics: dict[str, object] = {"selected": False}
        self._shadow_policy = shadow_policy or ShadowPolicy.from_env()
        self._shadow_backend_factory = shadow_backend_factory
        self._shadow_backends: dict[str, object] = {}
        self._shadow_selected = False
        self._shadow_pending = None
        self._shadow_windows: list[dict[str, object]] = []

    @staticmethod
    def _valid_model_dir(path: Path) -> tuple[bool, str]:
        if not path.is_dir():
            return False, "directory does not exist"
        if not (path / "config.json").is_file():
            return False, "config.json is missing"
        has_weights = any(path.glob("*.safetensors")) or (path / "pytorch_model.bin").is_file()
        if not has_weights:
            return False, "model weights are missing"
        # AutoProcessor needs tokenizer/processor metadata in addition to weights.
        processor_files = (
            "preprocessor_config.json",
            "tokenizer_config.json",
            "vocab.json",
        )
        if not any((path / name).is_file() for name in processor_files):
            return False, "processor/tokenizer files are missing"
        return True, "ok"

    @classmethod
    def _candidate_paths(cls, code: str, configured: str = "") -> list[Path]:
        dirname = cls.MODEL_DIR_NAMES.get(code, "")
        paths: list[Path] = []
        if configured:
            paths.append(Path(configured).expanduser())
        if not dirname:
            return paths

        roots: list[Path] = []
        if meipass := getattr(sys, "_MEIPASS", None):
            roots.append(Path(meipass))
        roots.append(Path(sys.executable).resolve().parent)
        here = Path(__file__).resolve()
        roots.extend([here.parents[2], here.parents[3], Path.cwd()])

        # Cover development checkout, unpacked Electron/PyInstaller layouts and
        # the full offline installer layout. De-duplicate without resolving
        # nonexistent paths (important on Windows network/removable drives).
        seen: set[str] = set()
        unique_roots: list[Path] = []
        for root in roots:
            for parent in (root, root.parent, root.parent.parent):
                key = os.path.normcase(os.path.abspath(str(parent)))
                if key not in seen:
                    seen.add(key)
                    unique_roots.append(parent)
        relatives = (
            Path("models") / "ctc" / dirname,
            Path("downloads") / "models" / "ctc" / dirname,
            Path("backend") / "models" / "ctc" / dirname,
            Path("_internal") / "models" / "ctc" / dirname,
            Path("resources") / "backend" / "_internal" / "models" / "ctc" / dirname,
        )
        for root in unique_roots:
            for rel in relatives:
                paths.append(root / rel)

        deduped: list[Path] = []
        seen.clear()
        for path in paths:
            key = os.path.normcase(os.path.abspath(str(path)))
            if key not in seen:
                seen.add(key)
                deduped.append(path)
        return deduped

    @classmethod
    def from_environment(cls) -> CTCWordAligner:
        configured = {
            "ru": os.getenv("KARAOKE_AI_CTC_RU_MODEL", "").strip(),
            "uk": os.getenv("KARAOKE_AI_CTC_UK_MODEL", "").strip(),
            "en": os.getenv("KARAOKE_AI_CTC_EN_MODEL", "").strip(),
        }
        instance = cls({key: value for key, value in configured.items() if value})
        # Resolve known language models eagerly so diagnostics/health show the
        # actual path even when backend config did not populate environment vars.
        for code in ("ru", "uk"):
            instance._resolve_model(code)
        return instance

    def _resolve_model(self, code: str) -> str:
        configured = self.models.get(code, "")
        checked: list[dict[str, str]] = []
        for candidate in self._candidate_paths(code, configured):
            ok, reason = self._valid_model_dir(candidate)
            checked.append({"path": str(candidate), "reason": reason})
            if ok:
                resolved = str(candidate.resolve())
                self.models[code] = resolved
                self.last_resource_diagnostics[code] = {
                    "available": True,
                    "path": resolved,
                    "reason": "ok",
                    "checked": checked,
                }
                return resolved
        reason = checked[0]["reason"] if configured and checked else "no valid local model found"
        self.last_resource_diagnostics[code] = {
            "available": False,
            "path": configured,
            "reason": reason,
            "checked": checked,
        }
        return ""

    def available_for(self, language: str | None, text: str = "") -> bool:
        code = _language_code(language, text)
        if not code:
            self.last_resource_diagnostics["unknown"] = {
                "available": False,
                "path": "",
                "reason": "language could not be determined",
                "checked": [],
            }
            return False
        return bool(self._resolve_model(code))

    def _load(self, language: str | None, text: str = ""):
        code = _language_code(language, text)
        model_path = self._resolve_model(code)
        if not model_path:
            details = self.last_resource_diagnostics.get(code, {})
            raise EngineUnavailableError(
                f"No usable local CTC alignment model for {code or 'language'}: "
                f"{details.get('reason', 'not found')}"
            )
        if (
            self._loaded_key == model_path
            and self._model is not None
            and self._processor is not None
        ):
            return self._processor, self._model
        try:
            import torch
            from transformers import (
                AutoFeatureExtractor,
                AutoModelForCTC,
                AutoProcessor,
                AutoTokenizer,
                Wav2Vec2Processor,
            )
        except ImportError as exc:
            raise EngineUnavailableError(
                "transformers + torch are required for CTC alignment"
            ) from exc

        self.release()
        model_key = f"ctc_{code}"
        self._device = select_torch_device(torch, model_key)

        # Some local CTC checkpoints (notably *-with-small-lm models) advertise
        # Wav2Vec2ProcessorWithLM in their metadata. AutoProcessor then requires
        # pyctcdecode/kenlm even though this aligner never decodes with an LM: we
        # consume the model logits directly in a CTC Viterbi forced alignment.
        # Prefer AutoProcessor for ordinary checkpoints, but transparently fall
        # back to a plain feature-extractor + tokenizer processor when the LM
        # wrapper dependency is unavailable.
        try:
            with profile_operation("model.load.ctc_processor"):
                self._processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
        except ImportError as exc:
            message = str(exc).lower()
            if "pyctcdecode" not in message and "processorwithlm" not in message:
                raise
            with profile_operation("model.load.ctc_processor"):
                feature_extractor = AutoFeatureExtractor.from_pretrained(
                    model_path, local_files_only=True
                )
                tokenizer = AutoTokenizer.from_pretrained(model_path, local_files_only=True)
                self._processor = Wav2Vec2Processor(
                    feature_extractor=feature_extractor,
                    tokenizer=tokenizer,
                )

        with profile_operation("model.load.ctc"):
            self._model = AutoModelForCTC.from_pretrained(model_path, local_files_only=True)
            try:
                self._model.eval().to(self._device)
            except Exception as exc:
                fallback = fallback_torch_device(model_key, self._device, exc)
                if fallback is None:
                    raise
                self._device = fallback
                self._model.eval().to(fallback)
        self._loaded_key = model_path
        return self._processor, self._model

    def release(self) -> None:
        self._processor = None
        self._model = None
        self._loaded_key = ""
        try:
            import gc

            import torch

            gc.collect()
            if torch.cuda.is_available():
                torch.cuda.empty_cache()
        except ImportError:
            pass
        if not self._shadow_policy.keep_session_resident:
            self.release_shadow()

    def release_shadow(self) -> None:
        for backend in self._shadow_backends.values():
            with suppress(Exception):  # optional cleanup cannot fail production
                backend.release()
        self._shadow_backends.clear()

    def _begin_shadow(self, audio_path: str | Path, language: str | None, text: str) -> None:
        code = _language_code(language, text)
        identity = f"{Path(audio_path)}|{code}"
        self._shadow_selected = code in {"ru", "uk"} and self._shadow_policy.selects(identity)
        self._shadow_pending = None
        self._shadow_windows = []
        self.last_shadow_diagnostics = {
            "selected": self._shadow_selected,
            "model": f"ctc_{code}" if code else "",
            "production": "pytorch:cuda:fp16-or-cpu:fp32",
            "shadow": "onnxruntime:cuda:fp16",
            "resident": self._shadow_policy.keep_session_resident,
            "windows": self._shadow_windows,
            "failures": 0,
        }

    def _record_shadow_failure(self, exc: Exception) -> None:
        self._shadow_pending = None
        self.last_shadow_diagnostics["failures"] = (
            int(self.last_shadow_diagnostics.get("failures", 0)) + 1
        )
        self._shadow_windows.append({"status": "failed", "error": f"{type(exc).__name__}: {exc}"})

    def _target_ids(self, processor, words: list[str]):
        tokenizer = processor.tokenizer
        blank_id = getattr(tokenizer, "pad_token_id", None)
        if blank_id is None:
            blank_id = 0
        unk_id = getattr(tokenizer, "unk_token_id", None)
        delimiter_id = getattr(tokenizer, "word_delimiter_token_id", None)

        target_ids: list[int] = []
        word_positions: list[list[int]] = []
        for word_index, raw_word in enumerate(words):
            normalized = _normalize_word(raw_word)
            if not normalized:
                raise InvalidArtifactError(f"CTC cannot normalize lyric token {raw_word!r}")
            encoded = tokenizer(normalized, add_special_tokens=False).input_ids
            encoded = [int(value) for value in encoded if int(value) != int(blank_id)]
            if unk_id is not None and any(value == int(unk_id) for value in encoded):
                raise InvalidArtifactError(
                    f"CTC vocabulary cannot represent lyric token {raw_word!r}"
                )
            if not encoded:
                raise InvalidArtifactError(f"CTC tokenizer produced no labels for {raw_word!r}")
            positions = list(range(len(target_ids), len(target_ids) + len(encoded)))
            target_ids.extend(encoded)
            word_positions.append(positions)
            if (
                word_index != len(words) - 1
                and delimiter_id is not None
                and int(delimiter_id) != int(blank_id)
            ):
                target_ids.append(int(delimiter_id))
        return target_ids, word_positions, int(blank_id)

    def _infer(self, audio: np.ndarray, sample_rate: int, language: str | None, text: str):
        processor, model = self._load(language, text)
        try:
            import torch
        except ImportError as exc:
            raise EngineUnavailableError("torch is required for CTC alignment") from exc
        inputs = processor(audio, sampling_rate=sample_rate, return_tensors="pt", padding=False)
        shadow_values = None
        if self._shadow_selected:
            try:
                shadow_values = inputs.input_values.detach().cpu().numpy()
            except Exception as exc:  # noqa: BLE001 - shadow must never affect production
                self._record_shadow_failure(exc)
        try:
            with profile_operation("transfer.cpu_to_gpu.ctc", byte_count=audio.nbytes):
                input_values = inputs.input_values.to(self._device)
            if (attention_mask := getattr(inputs, "attention_mask", None)) is not None:
                attention_mask = attention_mask.to(self._device)
            logits = PyTorchCTCBackend(model, self._device).infer(input_values, attention_mask)
        except Exception as exc:
            code = _language_code(language, text)
            fallback = fallback_torch_device(f"ctc_{code}", self._device, exc)
            if fallback is None:
                raise
            self.release()
            return self._infer(audio, sample_rate, language, text)
        if shadow_values is not None:
            code = _language_code(language, text)
            try:
                backend = self._shadow_backends.get(code)
                if backend is None:
                    backend = self._shadow_backend_factory(f"ctc_{code}")
                    self._shadow_backends[code] = backend
                shadow = backend.infer(shadow_values)
                shadow_logits = torch.from_numpy(shadow.logits).float()
                if shadow_logits.shape != logits.shape:
                    raise ValueError(
                        f"CTC shadow shape mismatch: {tuple(logits.shape)} != "
                        f"{tuple(shadow_logits.shape)}"
                    )
                production_cpu = logits.detach().cpu()
                difference = (production_cpu - shadow_logits).abs()
                production_argmax = production_cpu.argmax(dim=-1)
                shadow_argmax = shadow_logits.argmax(dim=-1)
                changed = (production_argmax != shadow_argmax).nonzero().flatten()
                self._shadow_pending = torch.log_softmax(shadow_logits, dim=-1)
                self._shadow_windows.append(
                    {
                        "status": "compared",
                        **describe_inference(shadow),
                        "frames": int(logits.shape[0]),
                        "labels": int(logits.shape[1]),
                        "logit_mae": float(difference.mean().item()),
                        "logit_max_abs": float(difference.max().item()),
                        "argmax_agreement": float(
                            (production_argmax == shadow_argmax).float().mean().item()
                        ),
                        "argmax_changed_frames": int(changed.numel()),
                        "argmax_changed_indices": changed[:32].tolist(),
                    }
                )
            except Exception as exc:  # noqa: BLE001 - shadow must never affect production
                self._record_shadow_failure(exc)
        return torch.log_softmax(logits, dim=-1), processor

    def _compare_shadow_words(
        self,
        production: list[Word],
        target_ids: list[int],
        positions: list[list[int]],
        blank_id: int,
        words: list[str],
        duration: float,
    ) -> None:
        shadow_log_probs, self._shadow_pending = self._shadow_pending, None
        if shadow_log_probs is None or not self._shadow_windows:
            return
        record = self._shadow_windows[-1]
        try:
            shadow_words, confidence = _word_spans_from_ctc(
                shadow_log_probs, target_ids, positions, blank_id, words, duration
            )
            record["shadow_confidence"] = confidence
            record["production_words"] = len(production)
            record["shadow_words"] = len(shadow_words)
            record["production_word_values"] = _word_values(production)
            record["shadow_word_values"] = _word_values(shadow_words)
            if len(production) != len(shadow_words):
                record["word_timing_status"] = "count-mismatch"
                return
            deltas = [
                abs(left.start - right.start) * 1000
                for left, right in zip(production, shadow_words, strict=True)
            ] + [
                abs(left.end - right.end) * 1000
                for left, right in zip(production, shadow_words, strict=True)
            ]
            record["word_timing_status"] = "compared"
            record["word_timing_mae_ms"] = float(np.mean(deltas)) if deltas else 0.0
            record["word_timing_max_ms"] = max(deltas, default=0.0)
        except Exception as exc:  # noqa: BLE001 - diagnostic comparison is isolated
            record["word_timing_status"] = "failed"
            record["word_timing_error"] = f"{type(exc).__name__}: {exc}"

    def align_window(
        self,
        audio: np.ndarray,
        sample_rate: int,
        words: list[str],
        language: str | None,
    ) -> CTCLineResult | None:
        if audio.size < max(400, int(sample_rate * 0.12)) or not words:
            return None
        transcript = " ".join(words)
        log_probs, processor = self._infer(audio, sample_rate, language, transcript)
        target_ids, positions, blank_id = self._target_ids(processor, words)
        # CTC requires enough frames for labels plus repeated-label separation.
        repeats = sum(
            1 for left, right in zip(target_ids, target_ids[1:], strict=False) if left == right
        )
        if log_probs.shape[0] < len(target_ids) + repeats:
            return None
        local_words, confidence = _word_spans_from_ctc(
            log_probs,
            target_ids,
            positions,
            blank_id,
            words,
            len(audio) / sample_rate,
        )
        self._compare_shadow_words(
            local_words,
            target_ids,
            positions,
            blank_id,
            words,
            len(audio) / sample_rate,
        )
        if not local_words:
            return None
        return CTCLineResult(tuple(local_words), confidence, 0.0, len(audio) / sample_rate)

    def align_lines(
        self,
        audio_path: str | Path,
        groups: list[str],
        language: str | None,
        anchor_windows: dict[int, tuple[float, float, float]] | None = None,
    ) -> list[CTCLineResult | None]:
        self._begin_shadow(audio_path, language, "\n".join(groups))
        if not self.available_for(language, "\n".join(groups)):
            return [None] * len(groups)
        source, sample_rate = load_mono(audio_path, 16000)
        total = len(source) / sample_rate
        anchors = anchor_windows or {}
        output: list[CTCLineResult | None] = [None] * len(groups)
        cursor = 0.0
        attempted = retried = recovered = 0
        group_tokens = [
            [token for token in re.findall(r"\w+(?:[’'-]\w+)*", group, re.UNICODE) if token]
            for group in groups
        ]
        expected_values = [_expected_duration(tokens) for tokens in group_tokens if tokens]
        typical_expected = float(np.median(expected_values)) if expected_values else 1.0
        # Bounds follow this song's line-density distribution instead of assuming
        # every lyric line must live inside a universal 0.75-10 second window.
        expected_floor = (
            max(0.18, float(np.percentile(expected_values, 10)) * 0.55) if expected_values else 0.25
        )
        expected_ceiling = (
            max(typical_expected * 2.5, float(np.percentile(expected_values, 90)) * 1.8)
            if expected_values
            else 8.0
        )

        def run_window(start: float, end: float, words: list[str]):
            nonlocal attempted
            attempted += 1
            left = max(0, int(start * sample_rate))
            right = min(len(source), max(left + 1, int(end * sample_rate)))
            try:
                local = self.align_window(source[left:right], sample_rate, words, language)
            except (EngineUnavailableError, InvalidArtifactError, RuntimeError, ValueError):
                return None
            if self._shadow_selected and self._shadow_windows:
                self._shadow_windows[-1].update(
                    line_start=start,
                    line_end=end,
                    line_words=list(words),
                )
            if local is None:
                return None
            absolute = tuple(
                Word(start + word.start, start + word.end, raw, word.confidence, index)
                for index, (word, raw) in enumerate(zip(local.words, words, strict=True))
            )
            return local, absolute

        for line_index, group in enumerate(groups):
            words = [token for token in re.findall(r"\w+(?:[’'-]\w+)*", group, re.UNICODE) if token]
            if not words or cursor >= total:
                continue
            expected = max(expected_floor, min(expected_ceiling, _expected_duration(words)))
            density = expected / max(1, len(words))
            minimum = max(density * 0.30, expected / max(3.0, len(words) * 2.0))
            anchor = anchors.get(line_index)

            # Bound an unanchored line by neighboring acoustic/ASR line anchors.
            next_bound = total
            for j in range(line_index + 1, len(groups)):
                if j in anchors:
                    next_bound = float(anchors[j][0])
                    break

            if anchor is not None:
                astart, aend, score = map(float, anchor)
                uncertainty = max(0.15, min(1.0, 1.0 - score))
                lead = expected * (0.12 + 0.30 * uncertainty)
                tail = expected * (0.35 + 0.55 * uncertainty)
                start = max(0.0, min(cursor - expected * 0.06, astart - lead))
                desired = expected * (1.8 + 1.4 * uncertainty)
                end = min(total, max(aend + tail, start + desired))
                if next_bound > start:
                    end = min(end, max(aend + tail, next_bound + expected * 0.12))
            else:
                backtrack = expected * 0.08
                start = max(0.0, cursor - backtrack)
                forward = expected * 2.8
                end = min(total, start + forward)
                if next_bound > start:
                    end = min(end, next_bound + expected * 0.25)

            result = run_window(start, end, words)

            def usable(item, minimum=minimum, expected=expected, cursor=cursor) -> bool:
                if item is None:
                    return False
                local, absolute_words = item
                line_span = absolute_words[-1].end - absolute_words[0].start
                # The minimum accepted span scales with the expected sung line
                # duration and token density instead of a fixed millisecond rule.
                min_span = max(minimum, expected * 0.18)
                return (
                    local.confidence >= 0.035
                    and line_span >= min_span
                    and absolute_words[0].start >= cursor - expected * 0.08
                )

            # Local second pass only for a failed anchored line. It uses a much
            # tighter anchor-centred clip so repeated chorus text outside this
            # line cannot win the CTC path.
            if not usable(result) and anchor is not None:
                retried += 1
                astart, aend, score = map(float, anchor)
                narrow_lead = expected * (0.08 + 0.12 * max(0.0, 1.0 - score))
                narrow_tail = expected * (0.20 + 0.30 * max(0.0, 1.0 - score))
                retry_start = max(0.0, astart - narrow_lead, cursor - expected * 0.05)
                retry_end = min(total, max(aend + narrow_tail, retry_start + expected * 1.25))
                retry = run_window(retry_start, retry_end, words)
                if usable(retry):
                    result = retry
                    recovered += 1

            if not usable(result):
                continue
            local, absolute_words = result
            output[line_index] = CTCLineResult(absolute_words, local.confidence, start, end)
            cursor = absolute_words[-1].end

        self.last_alignment_diagnostics = {
            "attempted_windows": attempted,
            "retry_lines": retried,
            "retry_recovered_lines": recovered,
            "accepted_lines": sum(item is not None for item in output),
            "total_lines": len(groups),
            "shadow": self.last_shadow_diagnostics,
        }
        return output
