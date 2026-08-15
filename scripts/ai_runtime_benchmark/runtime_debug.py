"""Print a compact, vendor-neutral AI runtime diagnostic for the current PC.

This command never changes the production selection or installs runtimes. It is
safe to run on NVIDIA, AMD, Intel, or CPU-only systems and is intended to make
backend-selection problems debuggable from one report.
"""

from __future__ import annotations

import argparse
import importlib.util
import json
import os
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))

from AI import runtime  # noqa: E402
from AI.backend_registry import AI_BACKEND_REGISTRY  # noqa: E402

PRODUCTION_QUALITY = frozenset({"baseline", "validated"})


def _ensure_local_optional_paths() -> None:
    directml = ROOT / "downloads/runtimes/onnxruntime-directml"
    artifact = ROOT / "downloads/models/optimized/fcpe/fcpe-core.onnx"
    if directml.is_dir():
        os.environ.setdefault("KARAOKE_AI_ORT_DIRECTML_PATH", str(directml))
        if str(directml) not in sys.path:
            sys.path.insert(0, str(directml))
    if artifact.is_file():
        os.environ.setdefault("KARAOKE_AI_FCPE_ONNX", str(artifact))


def _vendor_matches(vendor_rule: str, hardware: runtime.HardwareProfile) -> bool:
    allowed = {item.strip() for item in vendor_rule.split(",") if item.strip()}
    if not allowed or "any" in allowed:
        return True
    present = {gpu.vendor for gpu in hardware.gpus}
    return bool(allowed & present)


def _candidate_rows(plan: runtime.RuntimePlan) -> dict[str, list[dict[str, object]]]:
    output: dict[str, list[dict[str, object]]] = {}
    for model in runtime.MODEL_ROLES:
        rows = []
        selected = plan.selected.get(model)
        for spec in AI_BACKEND_REGISTRY.candidates(model):
            try:
                availability = spec.availability()
                available = bool(availability.available)
                reason = availability.reason
            except Exception as exc:  # noqa: BLE001 - diagnostic only
                available = False
                reason = f"probe failed: {type(exc).__name__}: {exc}"
            production = spec.quality_status in PRODUCTION_QUALITY
            vendor_match = _vendor_matches(spec.vendor, plan.hardware)
            rows.append(
                {
                    "key": spec.key,
                    "selected": selected is not None and selected.key == spec.key,
                    "available": available,
                    "production_eligible": production,
                    "vendor_match": vendor_match,
                    "quality": spec.quality_status,
                    "benchmark": spec.benchmark_status,
                    "vendor": spec.vendor,
                    "reason": reason,
                }
            )
        output[model] = rows
    return output


def _ort_providers() -> list[str]:
    if importlib.util.find_spec("onnxruntime") is None:
        return []
    try:
        import onnxruntime as ort

        return list(ort.get_available_providers())
    except Exception:  # noqa: BLE001 - diagnostic only
        return []


def _openvino_devices() -> list[str]:
    if importlib.util.find_spec("openvino") is None:
        return []
    try:
        import openvino as ov

        return list(ov.Core().available_devices)
    except Exception:  # noqa: BLE001 - diagnostic only
        return []


def build_report(preference: str = "auto") -> dict[str, object]:
    _ensure_local_optional_paths()
    runtime.reset_runtime_for_tests()
    plan = runtime.configure_runtime(preference, force=True)
    return {
        "hardware": {
            "cpu": plan.hardware.cpu,
            "logical_cores": plan.hardware.logical_cores,
            "ram_bytes": plan.hardware.ram_bytes,
            "gpus": [
                {
                    "name": gpu.name,
                    "vendor": gpu.vendor,
                    "memory_bytes": gpu.memory_bytes,
                }
                for gpu in plan.hardware.gpus
            ],
            "cuda_available": plan.hardware.cuda_available,
            "cuda_version": plan.hardware.cuda_version,
        },
        "selected": {name: spec.key for name, spec in plan.selected.items()},
        "fallbacks": {
            name: [spec.key for spec in specs] for name, specs in plan.fallbacks.items()
        },
        "warnings": list(plan.warnings),
        "onnxruntime_providers": _ort_providers(),
        "openvino_devices": _openvino_devices(),
        "fcpe_onnx": os.getenv("KARAOKE_AI_FCPE_ONNX", ""),
        "directml_runtime": os.getenv("KARAOKE_AI_ORT_DIRECTML_PATH", ""),
        "candidates": _candidate_rows(plan),
    }


def _human(report: dict[str, object]) -> None:
    hardware = report["hardware"]
    print("A&D Voice AI runtime debug\n")
    print(f"CPU: {hardware['cpu']} ({hardware['logical_cores']} logical cores)")
    gpus = hardware["gpus"]
    if gpus:
        for index, gpu in enumerate(gpus):
            memory = int(gpu["memory_bytes"] or 0)
            suffix = f", {memory / 1024**3:.1f} GiB" if memory else ""
            print(f"GPU[{index}]: {gpu['name']} [{gpu['vendor']}]{suffix}")
    else:
        print("GPU: none detected")
    print(
        f"CUDA: {'available' if hardware['cuda_available'] else 'unavailable'}"
        + (f" ({hardware['cuda_version']})" if hardware["cuda_version"] else "")
    )
    print("ORT providers:", ", ".join(report["onnxruntime_providers"]) or "not installed")
    print("OpenVINO devices:", ", ".join(report["openvino_devices"]) or "not installed/none")
    print("FCPE ONNX:", report["fcpe_onnx"] or "not prepared")
    print("DirectML runtime:", report["directml_runtime"] or "not prepared")

    print("\nSelected production plan:")
    for model, key in report["selected"].items():
        print(f"  {runtime.MODEL_ROLES[model]:10s} -> {key}")

    print("\nRegistered candidates:")
    candidates = report["candidates"]
    for model in runtime.MODEL_ROLES:
        print(f"  [{runtime.MODEL_ROLES[model]}]")
        for row in candidates[model]:
            flags = []
            if row["selected"]:
                flags.append("SELECTED")
            flags.append("available" if row["available"] else "unavailable")
            flags.append("production" if row["production_eligible"] else f"quality={row['quality']}")
            if not row["vendor_match"]:
                flags.append("vendor-mismatch")
            print(f"    {row['key']:<32} {' | '.join(flags)}")
            if not row["available"] or not row["production_eligible"]:
                print(f"      -> {row['reason']}")
    if report["warnings"]:
        print("\nWarnings:")
        for warning in report["warnings"]:
            print(f"  - {warning}")


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--json", action="store_true")
    parser.add_argument("--preference", choices=("auto", "cuda", "cpu"), default="auto")
    args = parser.parse_args()
    report = build_report(args.preference)
    if args.json:
        print(json.dumps(report, ensure_ascii=False, indent=2))
    else:
        _human(report)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
