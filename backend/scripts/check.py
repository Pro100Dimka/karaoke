"""Single cross-platform quality gate for local development and CI."""
from __future__ import annotations

import subprocess
import sys

COMMANDS = (
    (sys.executable, "scripts/audit_distribution.py"),
    (sys.executable, "-m", "compileall", "-q", "app", "AI", "config.py", "database.py", "models.py", "schemas.py", "run.py"),
    (sys.executable, "-m", "ruff", "check", "."),
    (sys.executable, "-m", "mypy", "app", "config.py", "database.py", "models.py", "schemas.py", "run.py"),
    (sys.executable, "scripts/audit_architecture.py"),
    (sys.executable, "-m", "pytest", "-q", "--cov=app", "--cov-branch", "--cov-report=term-missing"),
)


def main() -> int:
    for command in COMMANDS:
        print(f"\n> {' '.join(command)}", flush=True)
        result = subprocess.run(command, check=False)
        if result.returncode:
            return result.returncode
    print("\nAll checks passed.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
