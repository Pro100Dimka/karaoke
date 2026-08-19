from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]


def test_directml_prepare_installs_runtime_without_dependencies(): text = (ROOT / "scripts" / "prepare-fcpe-directml-pilot.bat").read_text(encoding="utf-8"); assert ('--no-deps "onnxruntime-directml==%ORT_VER%"' in text) and ('--no-deps "onnx==%ONNX_VER%"' in text) and ('for %%P in (numpy scipy tensorflow protobuf ml_dtypes)' in text) and ('backend virtual environment is not modified' in text)


def test_directml_smoke_requires_isolation_gate(): smoke, file_gate = (ROOT / 'scripts' / 'test-fcpe-directml-smoke.bat').read_text(encoding='utf-8'), (ROOT / 'scripts' / 'test-fcpe-directml-file.bat').read_text(encoding='utf-8'); assert ('call test-directml-isolation.bat' in smoke) and ('call test-directml-isolation.bat' in file_gate)


def test_isolation_test_compares_backend_environment_before_and_after(): text = (ROOT / "scripts" / "test-directml-isolation.bat").read_text(encoding="utf-8"); assert ('environment_fingerprint.py" --output "%BEFORE%"' in text) and ('environment_fingerprint.py" --output "%AFTER%"' in text) and ('fc /b "%BEFORE%" "%AFTER%"' in text) and ('backend\\venv is unchanged' in text)


def test_directml_real_file_gate_forces_pytorch_reference_to_cpu():
    text = (ROOT / "scripts" / "ai_runtime_benchmark" / "directml_fcpe_file_gate.py").read_text(
        encoding="utf-8"
    )
    assert ('os.environ["SONGAPP_DEVICE"] = "cpu"' in text) and ('if estimator._device != "cpu":' in text) and ('print("Reference device: cpu")' in text) and ('print("DirectML provider: DmlExecutionProvider")' in text)


def test_directml_real_file_gate_can_auto_select_latest_vocal_and_print_decision(): bat, gate = (ROOT / 'scripts' / 'test-fcpe-directml-file.bat').read_text(encoding='utf-8'), (ROOT / 'scripts' / 'ai_runtime_benchmark' / 'directml_fcpe_file_gate.py').read_text(encoding='utf-8'); assert ('if "%~1"=="" (' in bat) and ('rglob("vocals.*")' in gate) and ('{".wav", ".flac"}' in gate) and ('print(" DECISION")' in gate) and ('"quality_pass": quality_pass' in gate) and ('"speed_pass": speed_pass' in gate) and ('"stage_candidate": provider_pass and quality_pass and speed_pass and target_hardware' in gate)
