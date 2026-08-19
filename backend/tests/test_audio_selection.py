from tests._shared import patch_attrs, raises, patch_many

import json
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.services import audio_service


def device(name, hostapi, *, inputs=0, outputs=0, rate=48000, input_latency=0.02, output_latency=0.02): return {'name': name, 'hostapi': hostapi, 'max_input_channels': inputs, 'max_output_channels': outputs, 'default_samplerate': rate, 'default_low_input_latency': input_latency, 'default_low_output_latency': output_latency}


def install_devices(monkeypatch, devices, hosts): monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", True); patch_attrs(monkeypatch, audio_service.sd, query_devices=Mock(side_effect=lambda index=None, **_kwargs: devices if index is None else devices[index]), query_hostapis=lambda index: {'name': hosts[index]})


def test_asio_bridge_path_and_driver_enumeration(monkeypatch, tmp_path):
    bridge = tmp_path / "KaraokeAsioBridge.exe"; patch_many(monkeypatch, (audio_service.config, "IS_FROZEN", True), (audio_service.sys, "executable", str(tmp_path / "Backend.exe"))); assert (audio_service._asio_bridge_path() == bridge) and (audio_service.list_asio_drivers() == [])

    bridge.write_bytes(b"bridge")
    run = Mock(
        return_value=SimpleNamespace(stdout='log\n{"drivers":["Studio ASIO", 4, "USB ASIO"]}\n')
    )
    monkeypatch.setattr(audio_service.subprocess, "run", run); assert audio_service.list_asio_drivers() == ["Studio ASIO", "USB ASIO"]; run.side_effect = OSError("cannot launch"); assert audio_service.list_asio_drivers() == []

    patch_attrs(monkeypatch, audio_service.config, IS_FROZEN=False, PROJECT_ROOT=tmp_path); assert audio_service._asio_bridge_path() == tmp_path / "build/asio/KaraokeAsioBridge.exe"


def test_device_token_latency_and_asio_hint_normalization(): assert (audio_service._device_tokens('USB Audio Device Microphone Pro') == {'usb', 'microphone', 'pro'}) and (audio_service._device_latency({'default_low_input_latency': '0.01'}, 'input') == 0.01) and (audio_service._device_latency({'default_low_input_latency': -1}, 'input') == 0) and (audio_service._device_latency({'default_low_input_latency': 'bad'}, 'input') == 1) and (audio_service._asio_device_hint(None) == '') and (audio_service._asio_device_hint('  Focusrite USB ASIO Driver ') == 'focusrite usb')


def test_resolved_device_prefers_default_then_low_latency_host(monkeypatch):
    devices = [
        device("Slow", 0, inputs=1, input_latency=0.1),
        device("Fast", 1, inputs=1, input_latency=0.01),
    ]
    install_devices(monkeypatch, devices, {0: "MME", 1: "Windows WASAPI"}); monkeypatch.setattr(audio_service.sd.default, "device", (1, -1)); assert (audio_service._resolved_device_index(None, 'input') == 1) and (audio_service._resolved_device_index(0, 'input') == 0)

    monkeypatch.setattr(audio_service.sd.default, "device", (-1, -1)); assert audio_service._resolved_device_index(None, "input") == 1; raises(RuntimeError, lambda: audio_service._resolved_device_index(None, 'output'), match='No output')


def test_low_latency_and_duplex_selection_match_physical_endpoint(monkeypatch):
    devices = [
        device("USB Studio Mic", 0, inputs=1),
        device("USB Studio Mic", 1, inputs=1, input_latency=0.005),
        device("USB Studio Speakers", 1, outputs=2, output_latency=0.006),
        device("HDMI Display", 0, outputs=2),
    ]
    install_devices(monkeypatch, devices, {0: "MME", 1: "Windows WASAPI"}); assert (audio_service._low_latency_equivalent(0, 'input') == 1) and (audio_service._matching_output_for_input(1, None) == 2) and (audio_service._low_latency_equivalent(3, 'output') == 3)


def test_duplex_selection_recovers_original_output_on_matching_host(monkeypatch):
    devices = [
        device("Mic", 0, inputs=1),
        device("Selected speakers", 0, outputs=2),
        device("Mapped speakers", 1, outputs=2),
    ]
    install_devices(monkeypatch, devices, {0: "MME", 1: "Windows WASAPI"}); monkeypatch.setattr(audio_service, "_low_latency_equivalent", Mock(return_value=2)); assert audio_service._matching_output_for_input(0, 1) == 1

    devices[1]["hostapi"] = 1; assert audio_service._matching_output_for_input(0, 1) == 1; devices[2]["hostapi"] = 0; assert audio_service._matching_output_for_input(0, 1) == 2


def test_asio_matching_and_preferred_device_fallbacks(monkeypatch):
    devices = [
        device("Focusrite USB Audio", 0, inputs=2, outputs=2),
        device("Focusrite USB ASIO", 1, inputs=2, outputs=2),
    ]
    install_devices(monkeypatch, devices, {0: "MME", 1: "ASIO"}); assert (audio_service._matching_asio_device_index('Focusrite USB ASIO', 'input') == 1) and (audio_service.preferred_input_device(None, 'asio', 'Focusrite USB ASIO') == 1) and (audio_service.preferred_input_device(0, 'asio', 'Focusrite USB ASIO') == 0) and (audio_service.preferred_output_device(1, 'asio', None, 'Focusrite USB ASIO') == 1) and (audio_service.preferred_output_device(None, 'asio', 0, None) == 0) and (audio_service.preferred_sample_rate(0) == 48000)

    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", False); assert (audio_service._matching_asio_device_index('Focusrite', 'input') is None) and (audio_service.preferred_input_device(4) == 4) and (audio_service.preferred_output_device(output_device_id=5) == 5) and (audio_service.preferred_sample_rate(0) == audio_service.config.RECORDING_SAMPLE_RATE)


def test_asio_matching_rejects_empty_or_unrelated_names(monkeypatch): devices = [device("Generic microphone", 0, inputs=1)]; install_devices(monkeypatch, devices, {0: "MME"}); assert (audio_service._matching_asio_device_index(None, 'input') is None) and (audio_service._matching_asio_device_index('Focusrite ASIO', 'input') is None) and (audio_service._matching_asio_device_index('Generic ASIO', 'output') is None) and (audio_service._is_wasapi_device(devices[0]) is False); monkeypatch.setattr(audio_service, "_matching_asio_device_index", Mock(return_value=4)); assert audio_service.preferred_output_device(None, "asio", None, "Studio") == 4; monkeypatch.setattr(audio_service, "_low_latency_equivalent", Mock(return_value=3)); assert (audio_service.preferred_input_device(None, 'auto') == 3) and (audio_service.preferred_output_device(0, 'asio', None, 'Studio') == 4); monkeypatch.setattr(audio_service, "_matching_output_for_input", Mock(return_value=7)); assert audio_service.preferred_output_device(0, "auto", 2) == 7; audio_service._matching_output_for_input.assert_called_once_with(3, 2)


def test_device_lists_expose_capabilities_and_host_api(monkeypatch):
    devices = [
        device("Microphone", 0, inputs=1),
        device("Interface", 1, inputs=2, outputs=2),
    ]
    install_devices(monkeypatch, devices, {0: "MME", 1: "ASIO"}); assert (audio_service.list_input_devices() == [{'index': 0, 'name': 'Microphone [MME]', 'max_input_channels': 1, 'default_samplerate': 48000, 'host_api': 'MME', 'is_asio': False}, {'index': 1, 'name': 'Interface [ASIO]', 'max_input_channels': 2, 'default_samplerate': 48000, 'host_api': 'ASIO', 'is_asio': True}]) and ([item['index'] for item in audio_service.list_output_devices()] == [1])

    monkeypatch.setattr(audio_service, "_AUDIO_BACKEND_AVAILABLE", False); assert audio_service.list_input_devices() == []


def test_monitor_worker_command_is_serializable(monkeypatch, tmp_path): launch = Mock(); monkeypatch.setattr(audio_service, "_launch_monitor_process", launch); patch_attrs(monkeypatch, audio_service.config, IS_FROZEN=False, BASE_DIR=tmp_path); options = {"input_device_id": 1, "gain": 1.5}; audio_service._start_monitor_worker(options); command = launch.call_args.args[0]; assert (command[1:4] == ['-m', 'app.services.monitor_worker', '--config']) and (json.loads(command[-1]) == options)
