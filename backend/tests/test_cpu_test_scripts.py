from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SCRIPTS = ROOT / "scripts"


def _text(name: str) -> str: return (SCRIPTS / name).read_text(encoding='utf-8')


def test_start_dev_cpu_enables_safe_tuning(): text = _text("start-dev-cpu.bat"); assert ('set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"' in text) and ('set "KARAOKE_CPU_TUNING=1"' in text) and ('set "KARAOKE_CPU_INTEROP_THREADS=1"' in text) and ('set "KARAOKE_CPU_INFERENCE_MODE=1"' in text)


def test_cpu_baseline_disables_tuning(): text = _text("start-dev-cpu-baseline.bat"); assert ('set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"' in text) and ('set "KARAOKE_CPU_TUNING="' in text) and ('set "KARAOKE_CPU_INFERENCE_MODE="' in text)


def test_legacy_tuned_alias_delegates_to_optimized_cpu_script(): text = _text("start-dev-cpu-tuned.bat"); assert 'call "%~dp0start-dev-cpu.bat" %*' in text
