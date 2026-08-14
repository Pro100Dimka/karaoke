"""Generate the authoritative current-PyTorch reference for isolated benchmarks."""

from __future__ import annotations

import argparse
import json

import numpy as np
import torch
from benchmark_worker import (
    ARTIFACTS,
    DURATIONS,
    MODELS,
    ResourceSampler,
    fcpe_post,
    load_audio,
    load_processor,
    timer,
)


def fcpe_reference():
    import torchfcpe

    model, cold_load = timer(lambda: torchfcpe.spawn_bundled_infer_model(device="cuda"))
    arrays, lengths = {}, []
    for duration in DURATIONS["fcpe"]:
        audio = load_audio(duration)
        runs, output = [], None
        for _ in range(3):
            wav = torch.from_numpy(audio).view(1, -1, 1).cuda()
            mel, preprocessing = timer(lambda wav=wav: model.wav2mel(wav, 16000))
            with torch.inference_mode():
                latent, inference = timer(lambda mel=mel: model.model(mel))
            output, postprocessing = timer(
                lambda latent=latent: fcpe_post(
                    latent.float().cpu().numpy()[0],
                    model.model.cent_table.float().cpu().numpy(),
                )
            )
            runs.append(
                {
                    "preprocessing": preprocessing,
                    "inference": inference,
                    "postprocessing": postprocessing,
                }
            )
        arrays[f"f0_{duration:g}"] = output[0]
        arrays[f"confidence_{duration:g}"] = output[1]
        warm = {key: float(np.median([run[key] for run in runs])) for key in runs[0]}
        lengths.append(
            {"seconds": duration, "warm": warm, "full_stage": sum(warm.values())}
        )
    return arrays, {
        "model": "fcpe",
        "backend": "pytorch-cuda",
        "precision": "fp32",
        "cold_load": cold_load,
        "lengths": lengths,
    }


def ctc_reference(name):
    from transformers import AutoModelForCTC

    processor, processor_load = timer(lambda: load_processor(MODELS[name]))
    model, model_load = timer(
        lambda: (
            AutoModelForCTC.from_pretrained(MODELS[name], local_files_only=True)
            .eval()
            .cuda()
        )
    )
    model.config.apply_spec_augment = False
    arrays, lengths = {}, []
    for duration in DURATIONS[name]:
        audio = load_audio(duration)
        runs, logits = [], None
        for _ in range(3):
            values, preprocessing = timer(
                lambda audio=audio: (
                    processor(
                        audio, sampling_rate=16000, return_tensors="pt", padding=False
                    ).input_values
                )
            )
            values = values.cuda()
            with torch.inference_mode(), torch.autocast("cuda", dtype=torch.float16):
                logits, inference = timer(
                    lambda values=values: (
                        model(input_values=values).logits[0].float().cpu().numpy()
                    )
                )
            _, postprocessing = timer(lambda logits=logits: logits.argmax(-1))
            runs.append(
                {
                    "preprocessing": preprocessing,
                    "inference": inference,
                    "postprocessing": postprocessing,
                }
            )
        arrays[f"logits_{duration:g}"] = logits
        warm = {key: float(np.median([run[key] for run in runs])) for key in runs[0]}
        lengths.append(
            {"seconds": duration, "warm": warm, "full_stage": sum(warm.values())}
        )
    return arrays, {
        "model": name,
        "backend": "pytorch-cuda",
        "precision": "fp16-autocast",
        "cold_load": processor_load + model_load,
        "lengths": lengths,
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("model", choices=("fcpe", "ctc_ru", "ctc_uk"))
    args = parser.parse_args()
    output = ARTIFACTS.parent / "reference"
    output.mkdir(parents=True, exist_ok=True)
    with ResourceSampler() as resources:
        arrays, result = (
            fcpe_reference() if args.model == "fcpe" else ctc_reference(args.model)
        )
    result.update(
        peak_rss_bytes=resources.peak_rss,
        peak_gpu_bytes=resources.peak_gpu,
        peak_cpu_percent=resources.peak_cpu,
        stable=True,
        status="success",
    )
    np.savez_compressed(output / f"{args.model}.npz", **arrays)
    (output / f"{args.model}.json").write_text(
        json.dumps(result, indent=2), encoding="utf-8"
    )
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
