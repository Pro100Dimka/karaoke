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
