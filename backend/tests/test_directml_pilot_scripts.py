from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_directml_prepare_installs_runtime_without_dependencies():
    text = (ROOT / "scripts" / "prepare-fcpe-directml-pilot.bat").read_text(encoding="utf-8")
    assert '--no-deps "onnxruntime-directml==%ORT_VER%"' in text
    assert '--no-deps "onnx==%ONNX_VER%"' in text
    assert "for %%P in (numpy scipy tensorflow protobuf ml_dtypes)" in text
    assert "backend virtual environment is not modified" in text


def test_directml_smoke_requires_isolation_gate():
    smoke = (ROOT / "scripts" / "test-fcpe-directml-smoke.bat").read_text(encoding="utf-8")
    file_gate = (ROOT / "scripts" / "test-fcpe-directml-file.bat").read_text(encoding="utf-8")
    assert "call test-directml-isolation.bat" in smoke
    assert "call test-directml-isolation.bat" in file_gate


def test_isolation_test_compares_backend_environment_before_and_after():
    text = (ROOT / "scripts" / "test-directml-isolation.bat").read_text(encoding="utf-8")
    assert 'environment_fingerprint.py" --output "%BEFORE%"' in text
    assert 'environment_fingerprint.py" --output "%AFTER%"' in text
    assert 'fc /b "%BEFORE%" "%AFTER%"' in text
    assert "backend\\venv is unchanged" in text


def test_directml_real_file_gate_forces_pytorch_reference_to_cpu():
    text = (ROOT / "scripts" / "ai_runtime_benchmark" / "directml_fcpe_file_gate.py").read_text(
        encoding="utf-8"
    )
    assert 'os.environ["SONGAPP_DEVICE"] = "cpu"' in text
    assert 'if estimator._device != "cpu":' in text
    assert 'print("Reference device: cpu")' in text
    assert 'print("DirectML provider: DmlExecutionProvider")' in text


def test_directml_real_file_gate_can_auto_select_latest_vocal_and_print_decision():
    bat = (ROOT / "scripts" / "test-fcpe-directml-file.bat").read_text(encoding="utf-8")
    gate = (ROOT / "scripts" / "ai_runtime_benchmark" / "directml_fcpe_file_gate.py").read_text(encoding="utf-8")
    assert 'if "%~1"=="" (' in bat
    assert 'rglob("vocals.*")' in gate
    assert '{".wav", ".flac"}' in gate
    assert 'print(" DECISION")' in gate
    assert '"quality_pass": quality_pass' in gate
    assert '"speed_pass": speed_pass' in gate
    assert '"stage_candidate": provider_pass and quality_pass and speed_pass and target_hardware' in gate
