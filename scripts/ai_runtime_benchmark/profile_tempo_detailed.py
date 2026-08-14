"""Read-only call-level profile of the current tempo/key implementation."""

from __future__ import annotations

import json
import time
from collections import defaultdict
from contextlib import ExitStack
from pathlib import Path
from unittest.mock import patch

import librosa
import numpy as np
import soundfile as sf
from AI.music import analyze_music

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "build/performance-baseline-after-v2/warm/song.wav"
OUTPUT = ROOT / "build/ai-runtime-benchmark/tempo-profile-detailed.json"


def main() -> None:
    calls: dict[str, list[dict[str, object]]] = defaultdict(list)

    def timed(name, function):
        def wrapper(*args, **kwargs):
            started = time.perf_counter()
            result = function(*args, **kwargs)
            elapsed = time.perf_counter() - started
            array = args[0] if args else None
            calls[name].append(
                {
                    "seconds": elapsed,
                    "input_shape": list(getattr(array, "shape", ())),
                    "output_shape": list(getattr(result, "shape", ())),
                    "n_fft": kwargs.get("n_fft", 2048),
                    "hop_length": kwargs.get("hop_length"),
                    "win_length": kwargs.get("win_length"),
                    "window": kwargs.get("window", "hann"),
                    "center": kwargs.get("center", True),
                }
            )
            return result

        return wrapper

    targets = {
        "stft": ("librosa.core.stft", librosa.core.stft),
        "hpss_filtering": ("librosa.decompose.hpss", librosa.decompose.hpss),
        "istft": ("librosa.core.istft", librosa.core.istft),
        "onset_strength": (
            "librosa.onset.onset_strength",
            librosa.onset.onset_strength,
        ),
        "beat_track": ("librosa.beat.beat_track", librosa.beat.beat_track),
        "chroma_cqt": ("librosa.feature.chroma_cqt", librosa.feature.chroma_cqt),
    }
    with ExitStack() as stack:
        for name, (target, function) in targets.items():
            stack.enter_context(patch(target, timed(name, function)))
        started = time.perf_counter()
        result = analyze_music(SOURCE)
        total = time.perf_counter() - started

    summary = {
        name: {
            "calls": len(items),
            "seconds": sum(float(item["seconds"]) for item in items),
            "details": items,
        }
        for name, items in calls.items()
    }
    measured = sum(float(item["seconds"]) for items in calls.values() for item in items)
    payload = {
        "source": str(SOURCE),
        "duration_seconds": sf.info(SOURCE).duration,
        "result": result,
        "full_stage_seconds": total,
        "instrumented_seconds_inclusive": measured,
        "note": "Nested timings are inclusive and must not be summed as exclusive time.",
        "calls": summary,
        "stft_reuse_observation": {
            "hpss_stft_calls": len(calls["stft"]),
            "hpss_inverse_stft_calls": len(calls["istft"]),
            "tempo_onset_passes": len(calls["onset_strength"]),
            "tempo_beat_passes": len(calls["beat_track"]),
            "chroma_passes": len(calls["chroma_cqt"]),
        },
        "numpy_version": np.__version__,
        "librosa_version": librosa.__version__,
    }
    OUTPUT.parent.mkdir(parents=True, exist_ok=True)
    OUTPUT.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    print(OUTPUT)


if __name__ == "__main__":
    main()
