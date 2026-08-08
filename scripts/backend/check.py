"""Single cross-platform quality gate for local development and CI."""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]
BACKEND_ROOT = PROJECT_ROOT / "backend"
SCRIPT_ROOT = PROJECT_ROOT / "scripts" / "backend"

COMMANDS = (
    (sys.executable, str(SCRIPT_ROOT / "audit_distribution.py")),
    (
        sys.executable,
        "-m",
        "compileall",
        "-q",
        "app",
        "AI",
        "config.py",
        "database.py",
        "models.py",
        "schemas.py",
        "run.py",
    ),
    (sys.executable, "-m", "ruff", "check", "."),
    (
        sys.executable,
        "-m",
        "mypy",
        "app",
        "config.py",
        "database.py",
        "models.py",
        "schemas.py",
        "run.py",
    ),
    (sys.executable, str(SCRIPT_ROOT / "audit_architecture.py")),
    (
        sys.executable,
        "-m",
        "pytest",
        "-q",
        "--cov=app",
        "--cov-branch",
        "--cov-report=term-missing",
    ),
)


def main() -> int:
    for command in COMMANDS:
        print(f"\n> {' '.join(command)}", flush=True)
        result = subprocess.run(command, check=False, cwd=BACKEND_ROOT)
        if result.returncode:
            return result.returncode
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
