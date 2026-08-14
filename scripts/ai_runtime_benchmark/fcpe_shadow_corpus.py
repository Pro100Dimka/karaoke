"""Corpus-level FCPE PyTorch versus ORT CUDA FP16 quality and latency gate."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
import urllib.request
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parents[2]
BUILD = ROOT / "build/fcpe-shadow-corpus"
DEPS = Path(
    os.getenv("KARAOKE_BENCHMARK_DEPS", ROOT.parent / ".karaoke-ai-benchmark-deps")
)
sys.path.insert(0, str(DEPS / "ort-gpu"))
sys.path.insert(0, str(ROOT / "backend"))
sys.path.insert(0, str(Path(__file__).parent))

from AI.audio import load_mono
from AI.engines.fcpe_backends import (
    OrtCudaFCPEBackend,
    decode_fcpe_latent,
    nearest_resize,
)
from AI.engines.pitch import FCPEPitchEstimator
from AI.models import PitchFrame
from AI.pitch_post import (
    fuse_pitch_with_yin,
    refine_pitch_confidence,
    stabilize_pitch,
)
from ctc_shadow_corpus import prepare_cases as prepare_ctc_cases


@dataclass(frozen=True, slots=True)
class PitchCase:
    name: str
    source: Path
    traits: tuple[str, ...]
    source_url: str = ""
    license: str = "local"


ENGLISH = PitchCase(
    "en-yama-yama-female-chorus",
    BUILD / "sources/en-yama-yama-man.ogg",
    ("en", "female", "chorus", "short", "real-recording", "cc0"),
    "https://commons.wikimedia.org/wiki/Special:Redirect/file/The_Yama_Yama_Man.ogg",
    "CC0-1.0",
)
ENGLISH_SHA256 = "6ef676b6769e4db3f2c9cbce99c5636458b638f9b43fdfb40f22d97f159cb63c"


def _sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for chunk in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(chunk)
    return digest.hexdigest()


def _download_english() -> None:
    if ENGLISH.source.is_file() and _sha256(ENGLISH.source) == ENGLISH_SHA256:
        return
    ENGLISH.source.parent.mkdir(parents=True, exist_ok=True)
    request = urllib.request.Request(
        ENGLISH.source_url, headers={"User-Agent": "A&D-Voice-Research/1.0"}
    )
    temporary = ENGLISH.source.with_suffix(".part")
    with (
        urllib.request.urlopen(request, timeout=120) as response,
        temporary.open("wb") as output,
    ):
        shutil.copyfileobj(response, output)
    if _sha256(temporary) != ENGLISH_SHA256:
        temporary.unlink(missing_ok=True)
        raise RuntimeError("English corpus checksum mismatch")
    temporary.replace(ENGLISH.source)


def _ffmpeg(source: Path, target: Path, audio_filter: str) -> None:
    executable = shutil.which("ffmpeg")
    if not executable:
        raise RuntimeError("ffmpeg is required")
    target.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            executable,
            "-hide_banner",
            "-loglevel",
            "error",
            "-y",
            "-i",
            str(source),
            "-af",
            audio_filter,
            str(target),
        ],
        check=True,
    )


def prepare_cases() -> tuple[PitchCase, ...]:
    _download_english()
    base = tuple(
        PitchCase(case.name, case.source, case.traits, case.source_url, case.license)
        for case in prepare_ctc_cases()
    )
    project = base[0]
    variants = BUILD / "variants"
    generated = (
        (
            "project-high-register",
            "asetrate=44100*1.25,aresample=44100",
            ("high-register",),
        ),
        (
            "project-low-register",
            "asetrate=44100*0.80,aresample=44100",
            ("low-register",),
        ),
        ("project-strong-vibrato", "vibrato=f=5:d=0.7", ("strong-vibrato",)),
        (
            "project-rasp-stress",
            "acompressor=threshold=-20dB:ratio=6,acrusher=bits=10:mix=0.25",
            ("rasp-stress", "synthetic-effect"),
        ),
    )
    output = [*base, ENGLISH]
    for name, audio_filter, traits in generated:
        target = variants / f"{name}.wav"
        if not target.is_file():
            _ffmpeg(project.source, target, audio_filter)
        output.append(PitchCase(name, target, project.traits + traits))
    return tuple(output)


def _frames(
    f0: np.ndarray,
    *,
    hop: int,
    sample_rate: int,
    energies: list[float] | None = None,
) -> list[PitchFrame]:
    output = []
    for index, value in enumerate(f0):
        hz = min(float(value), 1400.0)
        voiced = bool(np.isfinite(hz) and 55.0 <= hz <= 1400.0)
        energy = (
            energies[index] if energies is not None and index < len(energies) else 0.0
        )
        output.append(
            PitchFrame(
                index * hop / sample_rate,
                hz if voiced else 0.0,
                float(voiced),
                voiced,
                energy,
            )
        )
    return output


def _percentile(values: np.ndarray, percentile: float) -> float:
    return float(np.percentile(values, percentile)) if values.size else 0.0


def compare_tracks(
    reference: list[PitchFrame], candidate: list[PitchFrame]
) -> dict[str, object]:
    count = min(len(reference), len(candidate))
    left, right = reference[:count], candidate[:count]
    left_voiced = np.asarray([frame.voiced for frame in left], dtype=bool)
    right_voiced = np.asarray([frame.voiced for frame in right], dtype=bool)
    true_positive = int(np.sum(left_voiced & right_voiced))
    precision = true_positive / max(1, int(np.sum(right_voiced)))
    recall = true_positive / max(1, int(np.sum(left_voiced)))
    both = left_voiced & right_voiced
    left_f0 = np.asarray([frame.frequency for frame in left], dtype=np.float64)[both]
    right_f0 = np.asarray([frame.frequency for frame in right], dtype=np.float64)[both]
    cents = np.abs(
        1200 * np.log2(np.maximum(right_f0, 1e-12) / np.maximum(left_f0, 1e-12))
    )
    return {
        "frames": count,
        "frame_count_delta": len(candidate) - len(reference),
        "voiced_agreement": float(np.mean(left_voiced == right_voiced))
        if count
        else 1.0,
        "voiced_f1": 2 * precision * recall / max(1e-30, precision + recall),
        "voiced_false_positive": int(np.sum(~left_voiced & right_voiced)),
        "voiced_false_negative": int(np.sum(left_voiced & ~right_voiced)),
        "cents_mae": float(np.mean(cents)) if cents.size else 0.0,
        "cents_p95": _percentile(cents, 95),
        "cents_max": float(np.max(cents)) if cents.size else 0.0,
    }


def run_case(case: PitchCase, estimator, backend, torch) -> dict[str, object]:
    audio, sample_rate = load_mono(case.source, 16_000)
    peak = float(np.max(np.abs(audio)))
    if peak > 0.999:
        audio = np.ascontiguousarray(audio * (0.999 / peak), dtype=np.float32)
    started = time.perf_counter()
    production = estimator.estimate(case.source)
    production_sec = time.perf_counter() - started
    model = estimator._model
    tensor = torch.from_numpy(audio).view(1, -1, 1).to(estimator._device)
    with torch.inference_mode():
        started = time.perf_counter()
        mel = model.wav2mel(tensor, sample_rate)
        preprocessing_sec = time.perf_counter() - started
        latent = model.model(mel).float().cpu().numpy()
    cent_table = model.model.cent_table.float().cpu().numpy()
    reference_f0, reference_confidence = decode_fcpe_latent(latent, cent_table)
    target_length = len(production)
    reference_f0 = nearest_resize(reference_f0, target_length)[0]
    reference_confidence = nearest_resize(reference_confidence, target_length)[0]
    candidate = backend.infer(
        mel.detach().cpu().numpy(), cent_table, target_length=target_length
    )
    energies = [frame.energy for frame in production]
    candidate_frames = _frames(
        candidate.f0,
        hop=estimator.hop,
        sample_rate=estimator.sr,
        energies=energies,
    )
    reference_frames = _frames(
        reference_f0,
        hop=estimator.hop,
        sample_rate=estimator.sr,
        energies=energies,
    )
    raw = compare_tracks(reference_frames, candidate_frames)
    raw["confidence_mae"] = float(
        np.mean(np.abs(reference_confidence - candidate.confidence))
    )
    started = time.perf_counter()
    production_stable = stabilize_pitch(
        fuse_pitch_with_yin(
            refine_pitch_confidence(production, case.source, sample_rate=16_000),
            case.source,
            sample_rate=16_000,
            fmin_hz=55,
            fmax_hz=1400,
        )
    )
    production_post_sec = time.perf_counter() - started
    started = time.perf_counter()
    candidate_stable = stabilize_pitch(
        fuse_pitch_with_yin(
            refine_pitch_confidence(candidate_frames, case.source, sample_rate=16_000),
            case.source,
            sample_rate=16_000,
            fmin_hz=55,
            fmax_hz=1400,
        )
    )
    candidate_post_sec = time.perf_counter() - started
    return {
        "case": case.name,
        "traits": case.traits,
        "source": str(case.source),
        "source_sha256": _sha256(case.source),
        "duration_sec": len(audio) / sample_rate,
        "production_estimate_sec": production_sec,
        "preprocessing_sec": preprocessing_sec,
        "ort_session_initialization_sec": candidate.session_initialization_sec,
        "ort_inference_sec": candidate.inference_sec,
        "production_post_sec": production_post_sec,
        "candidate_post_sec": candidate_post_sec,
        "raw": raw,
        "stabilized": compare_tracks(production_stable, candidate_stable),
        "providers": candidate.providers,
        "input_bytes": candidate.input_bytes,
        "output_bytes": candidate.output_bytes,
    }


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--output", type=Path, default=BUILD / "fcpe-corpus-results.json"
    )
    parser.add_argument("--unload", action="store_true")
    args = parser.parse_args()
    os.environ["KARAOKE_AI_FCPE_ONNX"] = str(
        ROOT / "build/ai-runtime-benchmark/artifacts/fcpe-fp16.onnx"
    )
    import torch

    estimator = FCPEPitchEstimator()
    backend = OrtCudaFCPEBackend()
    cases = []
    for case in prepare_cases():
        cases.append(run_case(case, estimator, backend, torch))
        if args.unload:
            backend.release()
        print(case.name, cases[-1]["raw"], flush=True)
    payload = {
        "schema": 1,
        "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
        "resident": not args.unload,
        "cases": cases,
        "sources": [
            asdict(case) | {"source": str(case.source)} for case in prepare_cases()
        ],
    }
    args.output.parent.mkdir(parents=True, exist_ok=True)
    args.output.write_text(
        json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8"
    )
    print(args.output)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
