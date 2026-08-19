from tests._shared import assert_contains, project_text

import pytest


@pytest.mark.parametrize(
    ("script", "required"),
    [
        (
            "scripts/start-dev-cpu.bat",
            (
                'set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"',
                'set "KARAOKE_CPU_TUNING=1"',
                'set "KARAOKE_CPU_INTEROP_THREADS=1"',
                'set "KARAOKE_CPU_INFERENCE_MODE=1"',
            ),
        ),
        (
            "scripts/start-dev-cpu-baseline.bat",
            (
                'set "KARAOKE_AI_RUNTIME_OVERRIDE=cpu"',
                'set "KARAOKE_CPU_TUNING="',
                'set "KARAOKE_CPU_INFERENCE_MODE="',
            ),
        ),
        ("scripts/start-dev-cpu-tuned.bat", ('call "%~dp0start-dev-cpu.bat" %*',)),
    ],
)
def test_cpu_launcher_contracts(script, required):
    assert_contains(project_text(script), *required)
