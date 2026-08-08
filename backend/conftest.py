"""Make project imports stable regardless of the directory pytest is launched from."""

from __future__ import annotations

import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent
project_root = str(PROJECT_ROOT)
if project_root not in sys.path:
    sys.path.insert(0, project_root)


def pytest_sessionfinish(session, exitstatus):  # noqa: ARG001
    """Release pooled SQLite connections so test runs finish without resource warnings."""
    from database import engine

    engine.dispose()
