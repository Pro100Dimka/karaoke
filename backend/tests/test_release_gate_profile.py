from __future__ import annotations

import importlib.util
import os
import subprocess
from pathlib import Path
from unittest.mock import Mock

import pytest


SCRIPT = Path(__file__).resolve().parents[2] / "scripts/release_gate.py"


def test_release_gate_profile_attests_toolchain_and_environment(monkeypatch):
    spec = importlib.util.spec_from_file_location("release_gate_profile_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    monkeypatch.setenv("KARAOKE_RELEASE_PROFILE", "ci-test")

    profile = module.runtime_profile()

    assert profile["python"]
    assert profile["python_executable"]
    assert profile["node"] != "missing"
    assert profile["npm"] != "missing"
    assert profile["os"]
    assert profile["env:KARAOKE_RELEASE_PROFILE"] == "ci-test"


def test_release_steps_use_process_groups_and_fail_on_individual_timeout(monkeypatch, tmp_path):
    spec = importlib.util.spec_from_file_location("release_gate_timeout_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    process = Mock(pid=1234)
    popen = Mock(return_value=process)
    monkeypatch.setattr(module.subprocess, "Popen", popen)

    assert module._start_step("fixture", ["command"], tmp_path, None) is process
    kwargs = popen.call_args.kwargs
    assert kwargs["creationflags"] == (
        subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0
    )
    assert kwargs["start_new_session"] is (os.name != "nt")

    process.wait.side_effect = subprocess.TimeoutExpired("command", 0.1)
    terminate = Mock()
    monkeypatch.setattr(module, "_terminate_process_tree", terminate)
    monkeypatch.setattr(module, "step_timeout", Mock(return_value=0.1))
    with pytest.raises(module.StepFailure, match="timed out after 0.1 seconds"):
        module._finish_step("fixture", process)
    terminate.assert_called_once_with(process)
