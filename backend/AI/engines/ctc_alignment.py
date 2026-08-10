from __future__ import annotations

import math
import os
import re
import sys
from dataclasses import dataclass
from pathlib import Path

import numpy as np

from ..audio import load_mono
from ..errors import EngineUnavailableError, InvalidArtifactError
from ..models import Word
from .device import select_torch_device

_CLEAN = re.compile(r"[^\w]+", re.UNICODE)

CTC_ALIGNMENT_VERSION = "v1-wav2vec2-character-viterbi-local-lines"


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
    return max(0.75, min(10.0, 0.28 * len(tokens) + 0.055 * chars))


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
    states = torch.full((2 * len(target_ids) + 1,), int(blank_id), dtype=torch.long, device=log_probs.device)
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

    if count == 1:
        state = 0
    else:
        last_states = torch.tensor([count - 1, count - 2], device=log_probs.device)
        state = int(last_states[torch.argmax(previous[last_states])].item())

    path = [0] * frames
    path[-1] = state
    for frame in range(frames - 1, 0, -1):
        transition = int(back[frame, state].item())
        state -= transition
        if state < 0:
            raise InvalidArtifactError("CTC Viterbi backtrack left the state graph")
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

    path, state_labels = _ctc_viterbi_states(log_probs, target_ids, blank_id)
    frame_count = len(path)
    if frame_count <= 0 or duration_sec <= 0:
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
            token_scores[target_pos].append(float(torch.exp(log_probs[frame, label]).clamp(0, 1).item()))

    result: list[Word] = []
    all_scores: list[float] = []
    previous_end = 0.0
    for index, (word, target_positions) in enumerate(zip(words, word_target_positions, strict=True)):
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


class CTCWordAligner:
    """Multilingual acoustic word aligner for trusted lyrics.

    It uses a language-specific Wav2Vec2 CTC acoustic model and character-level
    Viterbi alignment. Unlike ASR anchors, the canonical lyric text is the target
    sequence itself, so recognized text can never replace or delete lyrics.
    """

    MODEL_DIR_NAMES = {
        "ru": "wav2vec2-large-xlsr-53-russian",
        "uk": "wav2vec2-xls-r-300m-uk",
    }

    def __init__(self, models: dict[str, str] | None = None):
        self.models = dict(models or {})
        self._processor = None
        self._model = None
        self._loaded_key = ""
        self._device = "cpu"
        self.last_resource_diagnostics: dict[str, object] = {}

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
        meipass = getattr(sys, "_MEIPASS", None)
        if meipass:
            roots.append(Path(meipass))
        try:
            roots.append(Path(sys.executable).resolve().parent)
        except Exception:
            pass
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
    def from_environment(cls) -> "CTCWordAligner":
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
                    "available": True, "path": resolved, "reason": "ok", "checked": checked
                }
                return resolved
        reason = checked[0]["reason"] if configured and checked else "no valid local model found"
        self.last_resource_diagnostics[code] = {
            "available": False, "path": configured, "reason": reason, "checked": checked
        }
        return ""

    def available_for(self, language: str | None, text: str = "") -> bool:
        code = _language_code(language, text)
        if not code:
            self.last_resource_diagnostics["unknown"] = {
                "available": False, "path": "", "reason": "language could not be determined", "checked": []
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
        if self._loaded_key == model_path and self._model is not None and self._processor is not None:
            return self._processor, self._model
        try:
            import torch
            from transformers import AutoModelForCTC, AutoProcessor
        except ImportError as exc:
            raise EngineUnavailableError("transformers + torch are required for CTC alignment") from exc

        self.release()
        self._device = select_torch_device(torch)
        self._processor = AutoProcessor.from_pretrained(model_path, local_files_only=True)
        self._model = AutoModelForCTC.from_pretrained(model_path, local_files_only=True)
        self._model.eval().to(self._device)
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
                raise InvalidArtifactError(f"CTC vocabulary cannot represent lyric token {raw_word!r}")
            if not encoded:
                raise InvalidArtifactError(f"CTC tokenizer produced no labels for {raw_word!r}")
            positions = list(range(len(target_ids), len(target_ids) + len(encoded)))
            target_ids.extend(encoded)
            word_positions.append(positions)
            if word_index != len(words) - 1 and delimiter_id is not None and int(delimiter_id) != int(blank_id):
                target_ids.append(int(delimiter_id))
        return target_ids, word_positions, int(blank_id)

    def _infer(self, audio: np.ndarray, sample_rate: int, language: str | None, text: str):
        processor, model = self._load(language, text)
        try:
            import torch
        except ImportError as exc:
            raise EngineUnavailableError("torch is required for CTC alignment") from exc
        inputs = processor(audio, sampling_rate=sample_rate, return_tensors="pt", padding=False)
        input_values = inputs.input_values.to(self._device)
        attention_mask = getattr(inputs, "attention_mask", None)
        if attention_mask is not None:
            attention_mask = attention_mask.to(self._device)
        kwargs = {"input_values": input_values}
        if attention_mask is not None:
            kwargs["attention_mask"] = attention_mask
        with torch.inference_mode():
            if str(self._device).startswith("cuda"):
                with torch.autocast(device_type="cuda", dtype=torch.float16):
                    logits = model(**kwargs).logits[0].float()
            else:
                logits = model(**kwargs).logits[0].float()
        return torch.log_softmax(logits, dim=-1), processor

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
        repeats = sum(1 for left, right in zip(target_ids, target_ids[1:], strict=False) if left == right)
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
        if not self.available_for(language, "\n".join(groups)):
            return [None] * len(groups)
        source, sample_rate = load_mono(audio_path, 16000)
        total = len(source) / sample_rate
        anchors = anchor_windows or {}
        output: list[CTCLineResult | None] = [None] * len(groups)
        cursor = 0.0

        for line_index, group in enumerate(groups):
            words = [token for token in re.findall(r"\w+(?:[’'-]\w+)*", group, re.UNICODE) if token]
            if not words or cursor >= total - 0.08:
                continue
            expected = _expected_duration(words)
            anchor = anchors.get(line_index)
            if anchor is not None:
                astart, aend, score = anchor
                start = max(0.0, min(cursor - 0.55, float(astart) - (1.2 if score >= 0.45 else 2.0)))
                end = min(total, max(float(aend) + 2.0, start + max(10.0, expected * 3.0 + 4.0)))
            else:
                start = max(0.0, cursor - 0.65)
                end = min(total, start + min(26.0, max(14.0, expected * 3.6 + 5.0)))
            if end <= start + 0.2:
                continue
            left = int(start * sample_rate)
            right = min(len(source), max(left + 1, int(end * sample_rate)))
            try:
                local = self.align_window(source[left:right], sample_rate, words, language)
            except (EngineUnavailableError, InvalidArtifactError, RuntimeError, ValueError):
                local = None
            if local is None:
                continue

            absolute_words = tuple(
                Word(start + word.start, start + word.end, raw, word.confidence, index)
                for index, (word, raw) in enumerate(zip(local.words, words, strict=True))
            )
            line_span = absolute_words[-1].end - absolute_words[0].start
            min_span = max(0.35, 0.11 * len(words) + 0.018 * sum(len(word) for word in words))
            # Low posterior or physically compressed alignment is not trusted.
            # Qwen gets a chance for that line instead of silently publishing it.
            if local.confidence < 0.035 or line_span < min_span:
                continue
            if absolute_words[0].start < cursor - 0.25:
                continue
            output[line_index] = CTCLineResult(absolute_words, local.confidence, start, end)
            cursor = absolute_words[-1].end
        return output
