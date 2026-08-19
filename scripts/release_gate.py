

import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONT = ROOT / "front"


def fail(message: str) -> "NoReturn": print(f"\n[RELEASE BLOCKED] {message}", file=sys.stderr); raise SystemExit(1)


def run(label: str, command: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    print(f"\n{'=' * 72}\n{label}\n{'=' * 72}", flush=True); print("> " + " ".join(command), flush=True); result = subprocess.run(command, cwd=cwd, env=env, check=False)
    if result.returncode: fail(f"{label} failed with exit code {result.returncode}")


def parse_node_version(raw: str) -> tuple[int, int, int]:
    match = re.fullmatch(r"v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?", raw.strip())
    if not match: fail(f"Could not parse Node version: {raw!r}")
    return tuple(map(int, match.groups()))  # type: ignore[return-value]


def node_is_supported(version: tuple[int, int, int]) -> bool: major, minor, patch = version; return (major == 22 and (minor, patch) >= (18, 0)) or (major >= 24 and (major > 24 or (minor, patch) >= (11, 0)))


def require_release_environment() -> tuple[str, str]:
    node = shutil.which("node"); npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not node or not npm: fail("Node/npm are required for a release; install the pinned frontend runtime first.")

    node_raw = subprocess.check_output([node, "--version"], text=True).strip(); node_version = parse_node_version(node_raw)
    if not node_is_supported(node_version):
        package = json.loads((FRONT / "package.json").read_text(encoding="utf-8")); fail(f"Node {node_raw} is outside front/package.json engines={package['engines']['node']}. Tests were NOT run.")

    if not (FRONT / "node_modules").is_dir(): fail("front/node_modules is missing. Release verification may not skip frontend/unit/E2E tests.")

    required_modules = [
        FRONT / "node_modules" / "@playwright" / "test",
        FRONT / "node_modules" / "electron",
        FRONT / "node_modules" / "vitest",
        FRONT / "node_modules" / "vite",
    ]
    missing = [str(path.relative_to(FRONT)) for path in required_modules if not path.exists()]
    if missing: fail("Required release-test dependencies are missing: " + ", ".join(missing))

    return node, npm


def main() -> int:
    _node, npm = require_release_environment()

    run("Backend static/architecture gate", [sys.executable, str(ROOT / "scripts" / "backend" / "check.py")], cwd=BACKEND)
    run(
        "Backend full suite + coverage",
        [
            sys.executable,
            "-m",
            "pytest",
            "-q",
            "--cov=app",
            "--cov=AI",
            "--cov=config",
            "--cov=database",
            "--cov=models",
            "--cov=schemas",
            "--cov-report=term-missing",
            "--cov-fail-under=95",
        ],
        cwd=BACKEND,
    )

    run("Frontend verify", [npm, "run", "verify"], cwd=FRONT)

    run("Frontend mutation gate", [npm, "run", "test:mutation"], cwd=FRONT)

    run("Browser user-journey E2E", [npm, "run", "test:e2e"], cwd=FRONT)

    run("Electron release-critical E2E", [npm, "run", "test:e2e:electron-release"], cwd=FRONT)

    print("\n[RELEASE GATE PASS] Every mandatory release layer ran and passed."); return 0


if __name__ == "__main__": raise SystemExit(main())
