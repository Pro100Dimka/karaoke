from tests._shared import assert_contains, assert_excludes, project_text

import pytest


@pytest.mark.parametrize(
    ("script", "required"),
    [
        (
            "scripts/prepare-fcpe-directml-pilot.bat",
            (
                '--no-deps "onnxruntime-directml==%ORT_VER%"',
                '--no-deps "onnx==%ONNX_VER%"',
                'for %%P in (numpy scipy tensorflow protobuf ml_dtypes)',
                'backend virtual environment is not modified',
            ),
        ),
        (
            "scripts/test-directml-isolation.bat",
            (
                'environment_fingerprint.py" --output "%BEFORE%"',
                'environment_fingerprint.py" --output "%AFTER%"',
                'fc /b "%BEFORE%" "%AFTER%"',
                r'backend\venv is unchanged',
            ),
        ),
        (
            "scripts/ai_runtime_benchmark/directml_fcpe_file_gate.py",
            (
                'os.environ["SONGAPP_DEVICE"] = "cpu"',
                'if estimator._device != "cpu":',
                'print("Reference device: cpu")',
                'print("DirectML provider: DmlExecutionProvider")',
            ),
        ),
    ],
)
def test_directml_script_contracts(script, required):
    assert_contains(project_text(script), *required)


def test_directml_smoke_requires_isolation_gate():
    for script in ("scripts/test-fcpe-directml-smoke.bat", "scripts/test-fcpe-directml-file.bat"):
        assert_contains(project_text(script), "call test-directml-isolation.bat")


def test_directml_real_file_gate_auto_selects_latest_vocal_and_prints_decision():
    bat = project_text("scripts/test-fcpe-directml-file.bat")
    gate = project_text("scripts/ai_runtime_benchmark/directml_fcpe_file_gate.py")
    assert_contains(bat, 'if "%~1"=="" (')
    assert_contains(
        gate,
        'rglob("vocals.*")',
        '{".wav", ".flac"}',
        'print(" DECISION")',
        '"quality_pass": quality_pass',
        '"speed_pass": speed_pass',
        '"stage_candidate": provider_pass and quality_pass and speed_pass and target_hardware',
    )
