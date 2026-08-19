

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from dataclasses import asdict, dataclass, replace
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
from common import DEPS, ROOT, sha256, write_json

import numpy as np

BUILD = ROOT / "build/ctc-shadow-corpus"
SOURCES = BUILD / "sources"
sys.path.insert(0, str(DEPS / "ort-gpu"))
sys.path.insert(0, str(ROOT / "backend"))


@dataclass(frozen=True, slots=True)
class CorpusCase: name: str; language: str; source: Path; lyrics: str; traits: tuple[str, ...]; source_url: str = ""; license: str = "local"; sha256: str = ""


EXTERNAL = (
    CorpusCase(
        "uk-lysenko-female-long",
        "Ukrainian",
        SOURCES / "uk-lysenko-oy-kryknuly.ogg",
        """Ой крикнули сірії гуси
В яру на ставу
Стала на все село слава
Про тую вдову
Не так слава, не так слава
Як той поговір
Що заїздив козак з Січі
До вдови у двір
Вечеряли у світлиці
Мед-вино пили
І в кімнаті на кроваті
Спочити лягли
Не минула слава тая
Не марне пішла
Удовиця у м’ясниці
Сина привела
Вигодувала малого
До школи дала
А із школи його взявши
Коня купила
А коня йому купивши
Сідельце сама
Самим шовком вишивала
Златом окула
Одягла його в червоний
В жупан дорогий
Посадила на коника
Гляньте, вороги
Подивітесь та й повела
Коня вздовж села
Та й привела до обозу
В військо оддала
А сама на прощу в Київ
В черниці пішла""",
        ("uk", "female", "long", "slow", "piano-accompaniment", "real-recording"),
        "https://upload.wikimedia.org/wikipedia/commons/9/9d/"
        "Lysenko-Oj_kryknuly_siri_husy.ogg",
        "CC-BY-SA-3.0",
        "d79e21fd2c340246ca8f92a3011137cb52e72f9c8528d68b58696821e3de97ef",
    ),
    CorpusCase(
        "uk-shchedryk-choir-fast",
        "Ukrainian",
        SOURCES / "uk-shchedryk-choir.ogg",
        """Щедрик, щедрик, щедрівочка
Прилетіла ластівочка
Стала собі щебетати
Господаря викликати
Вийди, вийди, господарю
Подивися на кошару
Там овечки покотились
А ягнички народились
В тебе товар весь хороший
Будеш мати мірку грошей
Хоч не гроші, то полова
В тебе жінка чорноброва
Щедрик, щедрик, щедрівочка
Прилетіла ластівочка""",
        ("uk", "choir", "short", "fast", "repeated-chorus", "real-recording"),
        "https://upload.wikimedia.org/wikipedia/commons/9/97/"
        "%D0%A9%D0%B5%D0%B4%D1%80%D0%B8%D0%BA_%28%D0%9A%D1%80%D0%B5%D1%87%D0%BA%D0%BE%2C_1969%29.ogg",
        "CC-BY-4.0",
        "a9c7fe4cdd6724e98676fcddfbf8388af82b925e3edc3d7db7e6b81246ef72d6",
    ),
    CorpusCase(
        "ru-shalyapin-male-repeated",
        "Russian",
        SOURCES / "ru-shalyapin-ey-ukhnem.ogg",
        """Эй, ухнем
Эй, ухнем
Еще разик, еще да раз
Разовьем мы березу
Разовьем мы кудряву
Ай-да, да ай-да
Ай-да, да ай-да
Разовьем мы кудряву
Мы по бережку идем
Песню солнышку поем
Эй, ухнем
Эй, ухнем
Еще разик, еще да раз""",
        ("ru", "male", "long", "slow", "repeated-chorus", "real-recording"),
        "https://upload.wikimedia.org/wikipedia/commons/8/8e/"
        "%D0%AD%D0%B9%2C_%D1%83%D1%85%D0%BD%D0%B5%D0%BC%21_-_"
        "%D0%A4%D1%91%D0%B4%D0%BE%D1%80_%D0%A8%D0%B0%D0%BB%D1%8F%D0%BF%D0%B8%D0%BD.ogg",
        "public-domain",
        "8f1bcedb3a5269aa007c8426be1d700a3b1ddcd5382a386424372388484bd1f8",
    ),
)




def _download(case: CorpusCase) -> None:
    if case.source.is_file() and sha256(case.source) == case.sha256: return
    case.source.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        case.source_url, headers={"User-Agent": "A&D-Voice-Research/1.0"}
    )
    temporary = case.source.with_suffix(case.source.suffix + ".part")
    with (
        urllib.request.urlopen(request, timeout=120) as response,
        temporary.open("wb") as target,
    ):
        shutil.copyfileobj(response, target)
    if sha256(temporary) != case.sha256:
        temporary.unlink(missing_ok=True); raise RuntimeError(f"Checksum mismatch for {case.name}")
    temporary.replace(case.source)


def prepare_cases() -> tuple[CorpusCase, ...]:
    for case in EXTERNAL: _download(case)
    project = CorpusCase(
        "ru-project-female",
        "Russian",
        ROOT
        / "build/performance-baseline-after-v2/warm/separated/vocals.midi-analysis.wav",
        (ROOT / "build/performance-baseline-after-v2/warm/lyrics.txt").read_text(
            encoding="utf-8-sig"
        ),
        ("ru", "female", "long", "real-project-song", "separated-vocal"),
    )
    variants = BUILD / "variants"; reverb = variants / "ru-project-strong-echo.wav"; weak = variants / "ru-project-weak-vocal.flac"; resampled = variants / "ru-project-22050.flac"
    bleed = variants / "ru-project-instrumental-bleed.wav"
    if not reverb.is_file():
        ffmpeg(
            project.source, reverb, "-af", "aecho=0.8:0.82:45|90|180:0.28|0.18|0.10"
        )
    if not weak.is_file(): ffmpeg(project.source, weak, "-af", "volume=0.08", "-ar", "48000")
    if not resampled.is_file(): ffmpeg(project.source, resampled, "-ar", "22050")
    if not bleed.is_file():
        instrumental = (
            ROOT / "build/performance-baseline-after-v2/warm/separated/instrumental.wav"
        )
        executable = shutil.which("ffmpeg")
        subprocess.run(
            [
                executable,
                "-hide_banner",
                "-loglevel",
                "error",
                "-y",
                "-i",
                str(project.source),
                "-i",
                str(instrumental),
                "-filter_complex",
                "[1:a]volume=0.2[bleed];[0:a][bleed]amix=inputs=2:duration=first:normalize=0",
                str(bleed),
            ],
            check=True,
        )
    return (
        project,
        replace(
            project,
            name="ru-project-strong-echo",
            source=reverb,
            traits=project.traits + ("strong-echo",),
        ),
        replace(
            project,
            name="ru-project-weak-vocal",
            source=weak,
            traits=project.traits + ("weak-vocal", "flac", "48khz"),
        ),
        replace(
            project,
            name="ru-project-22050-flac",
            source=resampled,
            traits=project.traits + ("flac", "22.05khz"),
        ),
        replace(
            project,
            name="ru-project-instrumental-bleed",
            source=bleed,
            traits=project.traits + ("instrumental-bleed",),
        ),
        *EXTERNAL,
    )


def _serialize_line(line):
    if line is None: return None
    return {
        "confidence": line.confidence,
        "window_start": line.window_start,
        "window_end": line.window_end,
        "words": [
            {
                "text": word.text,
                "start": word.start,
                "end": word.end,
                "confidence": word.confidence,
            }
            for word in line.words
        ],
    }


def _percentile(values: list[float], percentile: float) -> float: return float(np.percentile(values, percentile)) if values else 0.0


def _comparison(production, candidate) -> dict[str, object]:
    line_presence = [left is not None for left in production]; candidate_presence = [right is not None for right in candidate]; timing: list[float] = []; confidence: list[float] = []
    text_mismatches = 0
    for left, right in zip(production, candidate, strict=True):
        if left is None or right is None: continue
        left_words, right_words = list(left.words), list(right.words)
        if [word.text for word in left_words] != [word.text for word in right_words]:
            text_mismatches += 1; continue
        for a, b in zip(left_words, right_words, strict=True):
            timing.extend((abs(a.start - b.start) * 1000, abs(a.end - b.end) * 1000)); confidence.append(abs(a.confidence - b.confidence))
    return {
        "line_presence_equal": line_presence == candidate_presence,
        "production_lines": sum(line_presence),
        "candidate_lines": sum(candidate_presence),
        "text_mismatches": text_mismatches,
        "word_timing_mae_ms": float(np.mean(timing)) if timing else 0.0,
        "word_timing_p95_ms": _percentile(timing, 95),
        "word_timing_max_ms": max(timing, default=0.0),
        "word_confidence_mae": float(np.mean(confidence)) if confidence else 0.0,
    }


def _word_comparison(production, candidate) -> dict[str, object]:
    left_text = [word.text for word in production]; right_text = [word.text for word in candidate]; timing: list[float] = []; confidence: list[float] = []
    if left_text == right_text:
        for left, right in zip(production, candidate, strict=True):
            timing.extend(
                (
                    abs(left.start - right.start) * 1000,
                    abs(left.end - right.end) * 1000,
                )
            )
            confidence.append(abs(left.confidence - right.confidence))
    return {
        "canonical_text_equal": left_text == right_text,
        "production_words": len(production),
        "candidate_words": len(candidate),
        "word_timing_mae_ms": float(np.mean(timing)) if timing else 0.0,
        "word_timing_p95_ms": _percentile(timing, 95),
        "word_timing_max_ms": max(timing, default=0.0),
        "word_confidence_mae": float(np.mean(confidence)) if confidence else 0.0,
    }


def _ort_infer(aligner, backend, audio, sample_rate, language, text):
    import torch

    processor, _ = aligner._load(language, text)
    values = (
        processor(audio, sampling_rate=sample_rate, return_tensors="pt", padding=False)
        .input_values.detach()
        .cpu()
        .numpy()
    )
    shadow = backend.infer(values); return torch.log_softmax(torch.from_numpy(shadow.logits).float(), dim=-1), processor


def run_case(case: CorpusCase) -> dict[str, object]:
    from AI.backend_shadow import ShadowPolicy; from AI.engines.ctc_alignment import CTCWordAligner; from AI.engines.ctc_backends import OrtCudaCTCBackend; from AI.engines.text import _group_lyric_text

    groups = _group_lyric_text(case.lyrics); production = CTCWordAligner(shadow_policy=ShadowPolicy(True, 1, True)); started = time.perf_counter(); production_lines = production.align_lines(case.source, groups, case.language)
    production_sec = time.perf_counter() - started; shadow = dict(production.last_shadow_diagnostics); production.release_shadow(); production.release()

    code = "ctc_uk" if case.language.casefold().startswith("uk") else "ctc_ru"; ort = OrtCudaCTCBackend(code); candidate = CTCWordAligner(shadow_policy=ShadowPolicy(False, 0))
    candidate._infer = lambda audio, rate, language, text: _ort_infer(
        candidate, ort, audio, rate, language, text
    )
    started = time.perf_counter(); candidate_lines = candidate.align_lines(case.source, groups, case.language); candidate_sec = time.perf_counter() - started; candidate.release()
    ort.release()

    compared_windows = [
        item for item in shadow.get("windows", []) if item.get("status") == "compared"
    ]
    frames = sum(int(item.get("frames", 0)) for item in compared_windows)
    changed = sum(
        int(item.get("argmax_changed_frames", 0)) for item in compared_windows
    )
    return {
        "case": case.name,
        "language": case.language,
        "traits": case.traits,
        "source": str(case.source),
        "source_sha256": sha256(case.source),
        "groups": len(groups),
        "production_sec": production_sec,
        "candidate_sec": candidate_sec,
        "shadow_failures": shadow.get("failures", 0),
        "compared_windows": len(compared_windows),
        "frames": frames,
        "argmax_changed_frames": changed,
        "argmax_agreement": (frames - changed) / frames if frames else 0.0,
        "logit_mae_weighted": (
            sum(
                float(item["logit_mae"]) * int(item["frames"])
                for item in compared_windows
            )
            / frames
            if frames
            else 0.0
        ),
        "comparison": _comparison(production_lines, candidate_lines),
        "production": [_serialize_line(line) for line in production_lines],
        "candidate": [_serialize_line(line) for line in candidate_lines],
        "shadow": shadow,
    }


def run_hybrid_case(case: CorpusCase) -> dict[str, object]:
    from AI.backend_shadow import ShadowPolicy; from AI.engines.ctc_alignment import CTCWordAligner; from AI.engines.ctc_backends import OrtCudaCTCBackend; from AI.engines.text import Qwen3ForcedAligner

    baseline = Qwen3ForcedAligner(); baseline._ctc = CTCWordAligner(shadow_policy=ShadowPolicy(False, 0)); started = time.perf_counter(); production_words = baseline.align_long_text(case.source, case.lyrics, case.language)
    production_sec = time.perf_counter() - started; production_diagnostics = dict(baseline.last_alignment_diagnostics); baseline._model = None

    code = "ctc_uk" if case.language.casefold().startswith("uk") else "ctc_ru"; ort = OrtCudaCTCBackend(code); candidate = Qwen3ForcedAligner(); candidate._ctc = CTCWordAligner(shadow_policy=ShadowPolicy(False, 0))
    candidate._ctc._infer = lambda audio, rate, language, text: _ort_infer(
        candidate._ctc, ort, audio, rate, language, text
    )
    started = time.perf_counter(); candidate_words = candidate.align_long_text(case.source, case.lyrics, case.language); candidate_sec = time.perf_counter() - started; candidate_diagnostics = dict(candidate.last_alignment_diagnostics)
    candidate._model = None; ort.release()
    return {
        "production_sec": production_sec,
        "candidate_sec": candidate_sec,
        "comparison": _word_comparison(production_words, candidate_words),
        "production_diagnostics": production_diagnostics,
        "candidate_diagnostics": candidate_diagnostics,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output", type=Path, default=BUILD / "ctc-corpus-results.json"
    )
    parser.add_argument("--cases", nargs="*"); parser.add_argument("--hybrid", action="store_true"); parser.add_argument("--precision", choices=("fp16", "fp32"), default="fp16"); parser.add_argument("--ru-artifact", type=Path)
    parser.add_argument("--uk-artifact", type=Path); args = parser.parse_args(); suffix = "-fp16" if args.precision == "fp16" else ""
    os.environ["KARAOKE_AI_CTC_RU_ONNX"] = str(
        args.ru_artifact
        or ROOT / f"build/ai-runtime-benchmark/artifacts/ctc_ru{suffix}.onnx"
    )
    os.environ["KARAOKE_AI_CTC_UK_ONNX"] = str(
        args.uk_artifact
        or ROOT / f"build/ai-runtime-benchmark/artifacts/ctc_uk{suffix}.onnx"
    )
    os.environ["KARAOKE_AI_CTC_SHADOW"] = "1"; os.environ["KARAOKE_AI_CTC_SHADOW_RATE"] = "1"; cases = prepare_cases(); selected = set(args.cases or ())
    if selected: cases = tuple(case for case in cases if case.name in selected)
    results = []
    for case in cases:
        print(f"[ctc-corpus] {case.name}", flush=True); result = run_case(case)
        if args.hybrid:
            print(f"[ctc-corpus] {case.name} hybrid", flush=True); result["hybrid"] = run_hybrid_case(case)
        results.append(result)
    payload = {
        "schema": 1,
        "precision": args.precision,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "cases": results,
        "sources": [
            {
                **asdict(case),
                "source": str(case.source),
            }
            for case in cases
        ],
    }
    write_json(args.output, payload, ensure_ascii=False); print(args.output, flush=True); return 0


if __name__ == "__main__": raise SystemExit(main())
