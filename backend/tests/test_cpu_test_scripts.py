from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"


def _text(name: str) -> str:
    return (SCRIPTS / name).read_text(encoding="utf-8")


def test_start_dev_cpu_enables_safe_tuning():
    text = _text("start-dev-cpu.bat")
    assert 'set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"' in text
    assert 'set "KARAOKE_CPU_TUNING=1"' in text
    assert 'set "KARAOKE_CPU_INTEROP_THREADS=1"' in text
    assert 'set "KARAOKE_CPU_INFERENCE_MODE=1"' in text
    assert 'where cl.exe >nul 2>nul' in text
    assert 'set "KARAOKE_LYRICS_VERBOSE="' in text
    assert 'set "KARAOKE_LYRICS_LOG_TEXT=1"' in text


def test_cpu_baseline_disables_tuning():
    text = _text("start-dev-cpu-baseline.bat")
    assert 'set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"' in text
    assert 'set "KARAOKE_CPU_TUNING="' in text
    assert 'set "KARAOKE_CPU_INFERENCE_MODE="' in text


def test_legacy_tuned_alias_delegates_to_optimized_cpu_script():
    text = _text("start-dev-cpu-tuned.bat")
    assert 'call "%~dp0start-dev-cpu.bat" %*' in text


def test_start_dev_cpu_uses_autotune_cache_when_available():
    text = _text("start-dev-cpu.bat")
    assert "cpu-separation-threads.txt" in text
    assert 'set /p THREADS=<"%THREAD_CACHE%"' in text


def test_cpu_separation_tuner_scripts_are_wired():
    bat = _text("tune-cpu-separation.bat")
    py = _text("tune_cpu_separation.py")
    assert "tune_cpu_separation.py" in bat
    assert "cpu-separation-threads.txt" in py
    assert "start-dev-cpu.bat will use this value automatically" in py


def test_openvino_cpu_pilot_scripts_are_wired():
    prepare = _text("prepare-roformer-openvino-cpu-pilot.bat")
    bench = _text("benchmark-cpu-separation-openvino.bat")
    start = _text("start-dev-cpu-openvino.bat")
    py = _text("benchmark_cpu_separation_openvino.py")
    assert "openvino==%VERSION%" in prepare
    assert "benchmark_cpu_separation_openvino.py" in bench
    assert 'call "%ROOT%\\scripts\\prepare-roformer-openvino-cpu-pilot.bat" || exit /b 1' in bench
    assert 'set "KARAOKE_CPU_COMPILE_BACKEND=openvino"' in start
    assert "cpu-separation-backend.txt" in py
    assert "Stems byte-identical" in py


def test_start_dev_cpu_can_use_validated_openvino_backend_cache():
    text = _text("start-dev-cpu.bat")
    assert "cpu-separation-backend.txt" in text
    assert 'if /I "%CPU_BACKEND%"=="openvino"' in text
    assert 'set "KARAOKE_CPU_COMPILE_BACKEND=openvino"' in text
