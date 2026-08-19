from tests._shared import patch_attrs

import importlib.util
from pathlib import Path

from AI import runtime

ROOT = Path(__file__).resolve().parents[2]


def _load_runtime_debug(): path = ROOT / "scripts/ai_runtime_benchmark/runtime_debug.py"; spec = importlib.util.spec_from_file_location("karaoke_runtime_debug", path); assert spec is not None and spec.loader is not None; module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module); return module


def _profile(*, cuda=False, gpus=()): return runtime.HardwareProfile(cpu='Test CPU', logical_cores=16, ram_bytes=32 * 1024 ** 3, gpus=tuple(gpus), torch_available=True, cuda_available=cuda, cuda_version='12.6' if cuda else '')


def test_debug_runtime_script_reports_shadow_directml_without_selecting_it(monkeypatch):
    runtime_debug = _load_runtime_debug(); monkeypatch.setattr(runtime_debug, "_ensure_local_optional_paths", lambda: None); patch_attrs(monkeypatch, runtime, detect_hardware=lambda _torch=None: _profile(gpus=(runtime.GPUInfo('AMD Radeon RX Test', 'amd', 8 * 1024 ** 3),))); patch_attrs(monkeypatch, runtime_debug, _ort_providers=lambda: ['DmlExecutionProvider'], _openvino_devices=lambda: [])
    report = runtime_debug.build_report(); assert (report['hardware']['gpus'][0]['vendor'], report['selected']['fcpe']) == ('amd', 'pytorch:cpu:fp32')
    directml = next(
        item
        for item in report["candidates"]["fcpe"]
        if item["key"] == "onnxruntime:directml:fp32"
    )
    assert (directml['production_eligible'] is False) and (directml['quality'] == 'shadow') and (directml['vendor_match'] is True)


def test_debug_runtime_vendor_match_distinguishes_intel_amd_nvidia(): runtime_debug, amd, intel, nvidia = _load_runtime_debug(), _profile(gpus=(runtime.GPUInfo('AMD Radeon', 'amd'),)), _profile(gpus=(runtime.GPUInfo('Intel Arc', 'intel'),)), _profile(gpus=(runtime.GPUInfo('NVIDIA RTX', 'nvidia'),)); assert (runtime_debug._vendor_matches('amd,intel', amd)) and (runtime_debug._vendor_matches('amd,intel', intel)) and (not runtime_debug._vendor_matches('amd,intel', nvidia))
