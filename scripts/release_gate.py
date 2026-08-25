

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import threading
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONT = ROOT / "front"
CLOUDFLARE = ROOT / "cloudflare"
GATE_STATE = ROOT / "generated" / "tests" / "release-gate.json"
GATE_SCHEMA = "release-gate-v2-incremental-mutation"


def release_fingerprint() -> str:
    roots = (
        BACKEND / "app", BACKEND / "AI", BACKEND / "tests",
        FRONT / "src", FRONT / "tests", FRONT / "scripts", FRONT / "electron",
        CLOUDFLARE / "src", CLOUDFLARE / "test", ROOT / "scripts" / "backend",
    )
    files = [
        path for root in roots if root.exists()
        for path in root.rglob("*") if path.is_file()
    ]
    files.extend(
        path for path in (
            BACKEND / "config.py", BACKEND / "database.py", BACKEND / "models.py",
            BACKEND / "schemas.py", BACKEND / "run.py", BACKEND / "pyproject.toml",
            FRONT / "package.json", FRONT / "package-lock.json", FRONT / "vite.config.mjs",
            FRONT / "vitest.config.mjs", FRONT / "stryker.config.mjs",
            FRONT / "playwright.config.mjs", FRONT / "playwright.release.config.mjs",
            CLOUDFLARE / "package.json", CLOUDFLARE / "package-lock.json",
            ROOT / "scripts" / "release_gate.py",
            ROOT / "scripts" / "build-installer.ps1",
            ROOT / "build-installer.bat", ROOT / "start-web.bat",
            ROOT / "verify-release.bat",
        ) if path.is_file()
    )
    digest = hashlib.sha256(GATE_SCHEMA.encode())
    for path in sorted(set(files)):
        relative = path.relative_to(ROOT).as_posix()
        if any(part in {"node_modules", "venv", ".runtime", ".stryker-tmp"} for part in path.parts):
            continue
        payload = path.read_bytes()
        if relative in {
            "front/package.json", "backend/pyproject.toml",
            "backend/app/services/diagnostics_service.py",
        }:
            payload = re.sub(
                rb'(?m)("version"\s*:\s*"|^version\s*=\s*"|BACKEND_VERSION\s*=\s*")\d+\.\d+\.\d+',
                rb'\g<1><release-version>',
                payload,
            )
        digest.update(relative.encode())
        digest.update(b"\0")
        digest.update(payload)
    return digest.hexdigest()


def cached_release_pass(fingerprint: str) -> bool:
    if os.getenv("KARAOKE_RELEASE_FULL") == "1": return False
    try: state = json.loads(GATE_STATE.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError): return False
    return state == {"schema": GATE_SCHEMA, "fingerprint": fingerprint}


def save_release_pass() -> None:
    GATE_STATE.parent.mkdir(parents=True, exist_ok=True)
    temporary = GATE_STATE.with_suffix(".tmp")
    temporary.write_text(
        json.dumps({"schema": GATE_SCHEMA, "fingerprint": release_fingerprint()}),
        encoding="utf-8",
    )
    temporary.replace(GATE_STATE)


def fail(message: str) -> NoReturn: print(f"\n[RELEASE BLOCKED] {message}", file=sys.stderr); raise SystemExit(1)


class StepFailure(Exception):
    """A gate step exited non-zero. Unlike fail(), this does not exit the
    process itself, so it can be raised from a worker thread and collected
    by whichever caller is coordinating parallel chains."""

    def __init__(self, label: str, code: int) -> None:
        super().__init__(f"{label} failed with exit code {code}")
        self.label = label
        self.code = code


# Subprocesses currently running as part of any chain (sequential or
# parallel). run_parallel uses this to kill every sibling step the moment
# one chain fails, instead of idly waiting for unrelated, possibly
# multi-minute steps to finish before the release gate can report the
# failure.
_active_processes: list[subprocess.Popen] = []
_active_lock = threading.Lock()


def _start_step(label: str, command: list[str], cwd: Path, env: dict[str, str] | None) -> subprocess.Popen:
    print(f"\n{'=' * 72}\n{label}\n{'=' * 72}", flush=True)
    print("> " + " ".join(command), flush=True)
    process = subprocess.Popen(command, cwd=cwd, env=env)
    with _active_lock:
        _active_processes.append(process)
    return process


def _finish_step(label: str, process: subprocess.Popen) -> None:
    try:
        code = process.wait()
    finally:
        with _active_lock:
            if process in _active_processes:
                _active_processes.remove(process)
    if code:
        raise StepFailure(label, code)


def run(label: str, command: list[str], *, cwd: Path, env: dict[str, str] | None = None) -> None:
    process = _start_step(label, command, cwd, env)
    try:
        _finish_step(label, process)
    except StepFailure as error:
        fail(str(error))


def run_chain(jobs: list[tuple[str, list[str], Path]]) -> None:
    """Run steps one after another, stopping at the first failure. Raises
    StepFailure (never exits the process) so this can drive one branch of
    run_parallel from inside a worker thread."""
    for label, command, cwd in jobs:
        process = _start_step(label, command, cwd, None)
        _finish_step(label, process)


def run_parallel(chains: list[list[tuple[str, list[str], Path]]]) -> None:
    """Run independent chains of sequential steps at the same time. Each
    chain's own steps still run strictly one after another (as separate OS
    processes), but the chains themselves overlap on separate threads, so
    e.g. the backend suite and the frontend mutation gate no longer wait on
    each other. If any step fails, every other currently running process is
    terminated right away rather than letting an unrelated multi-minute
    step run to completion before the gate reports the failure. Chains must
    be independent: none of them may depend on another chain's output."""
    errors: list[StepFailure] = []
    errors_lock = threading.Lock()

    def worker(chain: list[tuple[str, list[str], Path]]) -> None:
        try:
            run_chain(chain)
        except StepFailure as error:
            with errors_lock:
                errors.append(error)
            with _active_lock:
                for process in _active_processes:
                    process.terminate()

    threads = [threading.Thread(target=worker, args=(chain,)) for chain in chains]
    for thread in threads:
        thread.start()
    for thread in threads:
        thread.join()

    if errors:
        fail(str(errors[0]))


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
        CLOUDFLARE / "node_modules" / "wrangler",
    ]
    missing = [str(path.relative_to(ROOT)) for path in required_modules if not path.exists()]
    if missing: fail("Required release-test dependencies are missing: " + ", ".join(missing))

    return node, npm


def main() -> int:
    _node, npm = require_release_environment()
    fingerprint = release_fingerprint()
    if cached_release_pass(fingerprint):
        print("\n[RELEASE GATE CACHED PASS] Tested inputs are unchanged; reusing the last complete pass.")
        return 0

    # The backend suite (Python/venv) and the frontend verify+mutation chain
    # (Node/npm) never read each other's output, so they run as two
    # concurrent OS processes instead of one after another. Mutation testing
    # (test:mutation) is normally the single longest step in this gate, and
    # it previously could not even start until the entire backend suite had
    # finished; overlapping them removes that dead time from every release
    # build. The E2E/Electron/Cloudflare steps below stay sequential because
    # they build on the frontend's "verify" build output.
    run_parallel([
        [
            (
                "Backend static/architecture gate",
                [sys.executable, str(ROOT / "scripts" / "backend" / "check.py")],
                BACKEND,
            ),
            (
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
                    "--cov-fail-under=85",
                ],
                BACKEND,
            ),
        ],
        [
            ("Frontend verify", [npm, "run", "verify"], FRONT),
            ("Frontend mutation gate", [npm, "run", "test:mutation"], FRONT),
        ],
    ])

    run("Browser user-journey E2E", [npm, "run", "test:e2e"], cwd=FRONT)

    run("Electron release-critical E2E", [npm, "run", "test:e2e:electron-release"], cwd=FRONT)

    run("Online service tests", [npm, "test"], cwd=CLOUDFLARE)
    run("Online service dependency audit", [npm, "audit"], cwd=CLOUDFLARE)
    run("Online service deployment dry run", [npm, "run", "check"], cwd=CLOUDFLARE)

    save_release_pass()
    print("\n[RELEASE GATE PASS] Every mandatory release layer ran and passed."); return 0


if __name__ == "__main__": raise SystemExit(main())
