

import contextlib
import hashlib
import importlib.metadata
import json
import os
import platform
import re
import shutil
import signal
import subprocess
import sys
import threading
from datetime import UTC, datetime
from pathlib import Path
from typing import NoReturn

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONT = ROOT / "front"
CLOUDFLARE = ROOT / "cloudflare"
GATE_STATE = ROOT / "generated" / "tests" / "release-gate.json"
GATE_SCHEMA = "release-gate-v4-runtime-attestation"


def _file_digest(path: Path) -> str:
    if not path.is_file():
        return "missing"
    return hashlib.sha256(path.read_bytes()).hexdigest()


def _python_environment_digest() -> str:
    packages = sorted({
        f"{(distribution.metadata.get('Name') or '').casefold()}=={distribution.version}"
        for distribution in importlib.metadata.distributions()
        if distribution.metadata.get("Name")
    })
    return hashlib.sha256("\n".join(packages).encode("utf-8")).hexdigest()


def runtime_profile() -> dict[str, str]:
    node = shutil.which("node")
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    nvidia_smi = shutil.which("nvidia-smi")

    def version(command: list[str] | None) -> str:
        if not command or not command[0]:
            return "missing"
        try:
            return subprocess.check_output(command, text=True, stderr=subprocess.STDOUT).strip()
        except (OSError, subprocess.CalledProcessError) as error:
            return f"error:{type(error).__name__}"

    environment_keys = (
        "CI",
        "RUNNER_OS",
        "RUNNER_ARCH",
        "RUNNER_ENVIRONMENT",
        "ImageOS",
        "ImageVersion",
        "KARAOKE_RELEASE_PROFILE",
        "KARAOKE_RELEASE_FULL",
        "KARAOKE_AI_COMPUTE_MODE",
        "CUDA_VISIBLE_DEVICES",
        "CUDA_PATH",
        "PYTHONHASHSEED",
        "TF_ENABLE_ONEDNN_OPTS",
        "OMP_NUM_THREADS",
        "MKL_NUM_THREADS",
        "NODE_OPTIONS",
        "ADVOICE_REQUIRE_SIGNING",
        "ADVOICE_VS_PATH",
    )
    return {
        "os": platform.platform(),
        "machine": platform.machine(),
        "python": sys.version,
        "python_executable": str(Path(sys.executable).resolve()),
        "python_packages": _python_environment_digest(),
        "node": version([node, "--version"] if node else None),
        "node_executable": str(Path(node).resolve()) if node else "missing",
        "npm": version([npm, "--version"] if npm else None),
        "npm_executable": str(Path(npm).resolve()) if npm else "missing",
        "front_node_modules": _file_digest(FRONT / "node_modules" / ".package-lock.json"),
        "cloudflare_node_modules": _file_digest(
            CLOUDFLARE / "node_modules" / ".package-lock.json"
        ),
        "gpu_driver": version([
            nvidia_smi,
            "--query-gpu=name,driver_version",
            "--format=csv,noheader",
        ] if nvidia_smi else None),
        **{f"env:{key}": os.getenv(key, "") for key in environment_keys},
    }


def release_fingerprint(profile: dict[str, str] | None = None) -> str:
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
            BACKEND / "requirements-lock.txt", BACKEND / "requirements-api.txt",
            BACKEND / "requirements-lock.in",
            BACKEND / "requirements-dev.txt", BACKEND / "requirements.txt",
            FRONT / "package.json", FRONT / "package-lock.json", FRONT / "vite.config.mjs",
            FRONT / "vitest.config.mjs", FRONT / "stryker.config.mjs",
            FRONT / "playwright.config.mjs", FRONT / "playwright.release.config.mjs",
            CLOUDFLARE / "package.json", CLOUDFLARE / "package-lock.json",
            ROOT / "VERSION", ROOT / "scripts" / "sync_version.py",
            ROOT / "scripts" / "generate_python_lock.py",
            ROOT / "scripts" / "frontend_dependency_audit.py",
            ROOT / "scripts" / "security" / "frontend-audit-allowlist.json",
            ROOT / "scripts" / "backend_dependency_audit.py",
            ROOT / "scripts" / "generate_release_sbom.py",
            ROOT / "scripts" / "backend" / "generate_sbom.py",
            ROOT / "scripts" / "security" / "backend-audit-allowlist.json",
            ROOT / "scripts" / "security" / "cloudflare-audit-allowlist.json",
            ROOT / "scripts" / "release_gate.py",
            ROOT / "scripts" / "build-installer.ps1",
            ROOT / "build-installer.bat", ROOT / "start-web.bat",
            ROOT / "verify-release.bat",
            ROOT / ".github" / "workflows" / "release-gate.yml",
        ) if path.is_file()
    )
    digest = hashlib.sha256(GATE_SCHEMA.encode())
    digest.update(json.dumps(profile or runtime_profile(), sort_keys=True).encode("utf-8"))
    for path in sorted(set(files)):
        relative = path.relative_to(ROOT).as_posix()
        if any(part in {"node_modules", "venv", ".runtime", ".stryker-tmp"} for part in path.parts):
            continue
        payload = path.read_bytes()
        if relative == "VERSION":
            payload = b"<release-version>\n"
        elif relative in {
            "front/package.json", "front/package-lock.json",
            "backend/pyproject.toml",
            "backend/app/version.py",
            "cloudflare/package.json", "cloudflare/package-lock.json",
        }:
            payload = re.sub(
                rb'(?m)("version"\s*:\s*"|^version\s*=\s*"|APP_VERSION\s*=\s*")\d+\.\d+\.\d+',
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
    return (
        state.get("schema") == GATE_SCHEMA
        and state.get("fingerprint") == fingerprint
        and state.get("runtime_profile") == runtime_profile()
    )


def save_release_pass() -> None:
    GATE_STATE.parent.mkdir(parents=True, exist_ok=True)
    temporary = GATE_STATE.with_suffix(".tmp")
    profile = runtime_profile()
    temporary.write_text(
        json.dumps({
            "schema": GATE_SCHEMA,
            "fingerprint": release_fingerprint(profile),
            "runtime_profile": profile,
            "attested_at": datetime.now(UTC).isoformat(),
        }, sort_keys=True),
        encoding="utf-8",
    )
    temporary.replace(GATE_STATE)


def fail(message: str) -> NoReturn: print(f"\n[RELEASE BLOCKED] {message}", file=sys.stderr); raise SystemExit(1)


class StepFailure(Exception):
    """A gate step exited non-zero. Unlike fail(), this does not exit the
    process itself, so it can be raised from a worker thread and collected
    by whichever caller is coordinating parallel chains."""

    def __init__(self, label: str, code: int | str) -> None:
        message = f"{label} failed with exit code {code}"
        if isinstance(code, str) and code.startswith("timeout:"):
            message = f"{label} timed out after {code.removeprefix('timeout:')} seconds"
        super().__init__(message)
        self.label = label
        self.code = code


# Subprocesses currently running as part of any chain (sequential or
# parallel). run_parallel uses this to kill every sibling step the moment
# one chain fails, instead of idly waiting for unrelated, possibly
# multi-minute steps to finish before the release gate can report the
# failure.
_active_processes: list[subprocess.Popen] = []
_active_lock = threading.Lock()

STEP_TIMEOUT_SECONDS = {
    "Version consistency": 60,
    "Python hash lock consistency": 180,
    "Backend static/architecture gate": 600,
    "Backend full suite + coverage": 5400,
    "Backend dependency audit": 900,
    "Frontend production dependency audit": 600,
    "Frontend complete dependency audit": 600,
    "Frontend verify": 1800,
    "Frontend mutation gate": 5400,
    "Browser user-journey E2E": 1800,
    "Electron release-critical E2E": 1800,
    "Online service tests": 600,
    "Online service dependency audit": 600,
    "Online service deployment dry run": 600,
    "Backend SBOM": 600,
    "Frontend SBOM": 600,
    "Online service SBOM": 600,
    "Aggregate CycloneDX release SBOM": 600,
}


def step_timeout(label: str) -> float:
    override = os.getenv("KARAOKE_RELEASE_STEP_TIMEOUT", "").strip()
    if override:
        return max(0.1, float(override))
    return float(STEP_TIMEOUT_SECONDS.get(label, 1800))


def _terminate_process_tree(process: subprocess.Popen, grace_seconds: float = 5.0) -> None:
    if os.name == "nt":
        subprocess.run(
            ["taskkill", "/PID", str(process.pid), "/T"],
            capture_output=True,
            check=False,
        )
        try:
            process.wait(timeout=grace_seconds)
            return
        except subprocess.TimeoutExpired:
            subprocess.run(
                ["taskkill", "/PID", str(process.pid), "/T", "/F"],
                capture_output=True,
                check=False,
            )
    else:
        with contextlib.suppress(ProcessLookupError):
            os.killpg(process.pid, signal.SIGTERM)
        try:
            process.wait(timeout=grace_seconds)
            return
        except subprocess.TimeoutExpired:
            with contextlib.suppress(ProcessLookupError):
                os.killpg(process.pid, signal.SIGKILL)
    with contextlib.suppress(subprocess.TimeoutExpired):
        process.wait(timeout=5)


def _start_step(label: str, command: list[str], cwd: Path, env: dict[str, str] | None) -> subprocess.Popen:
    print(f"\n{'=' * 72}\n{label}\n{'=' * 72}", flush=True)
    print("> " + " ".join(command), flush=True)
    process = subprocess.Popen(
        command,
        cwd=cwd,
        env=env,
        creationflags=subprocess.CREATE_NEW_PROCESS_GROUP if os.name == "nt" else 0,
        start_new_session=os.name != "nt",
    )
    with _active_lock:
        _active_processes.append(process)
    return process


def _finish_step(label: str, process: subprocess.Popen) -> None:
    try:
        try:
            code = process.wait(timeout=step_timeout(label))
        except subprocess.TimeoutExpired:
            _terminate_process_tree(process)
            raise StepFailure(label, f"timeout:{step_timeout(label):g}") from None
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
                    _terminate_process_tree(process)

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
    run(
        "Version consistency",
        [sys.executable, str(ROOT / "scripts" / "sync_version.py"), "--check"],
        cwd=ROOT,
    )
    run(
        "Python hash lock consistency",
        [sys.executable, str(ROOT / "scripts" / "generate_python_lock.py"), "--check"],
        cwd=ROOT,
    )
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
            (
                "Backend dependency audit",
                [sys.executable, str(ROOT / "scripts" / "backend_dependency_audit.py")],
                ROOT,
            ),
            (
                "Backend SBOM",
                [sys.executable, str(ROOT / "scripts" / "backend" / "generate_sbom.py")],
                ROOT,
            ),
        ],
        [
            (
                "Frontend production dependency audit",
                [sys.executable, str(ROOT / "scripts" / "frontend_dependency_audit.py"), "--scope", "production"],
                ROOT,
            ),
            (
                "Frontend complete dependency audit",
                [sys.executable, str(ROOT / "scripts" / "frontend_dependency_audit.py"), "--scope", "all"],
                ROOT,
            ),
            ("Frontend SBOM", [npm, "run", "generate:sbom", "--", "frontend"], FRONT),
            ("Frontend verify", [npm, "run", "verify"], FRONT),
            ("Frontend mutation gate", [npm, "run", "test:mutation"], FRONT),
        ],
    ])

    run("Browser user-journey E2E", [npm, "run", "test:e2e"], cwd=FRONT)

    run("Electron release-critical E2E", [npm, "run", "test:e2e:electron-release"], cwd=FRONT)

    run("Online service tests", [npm, "test"], cwd=CLOUDFLARE)
    run(
        "Online service dependency audit",
        [
            sys.executable,
            str(ROOT / "scripts" / "frontend_dependency_audit.py"),
            "--project",
            "cloudflare",
            "--scope",
            "all",
        ],
        cwd=ROOT,
    )
    run(
        "Online service SBOM",
        [shutil.which("node") or "node", str(FRONT / "scripts" / "generate-sbom.mjs"), "cloudflare"],
        cwd=CLOUDFLARE,
    )
    run(
        "Aggregate CycloneDX release SBOM",
        [sys.executable, str(ROOT / "scripts" / "generate_release_sbom.py")],
        cwd=ROOT,
    )
    run("Online service deployment dry run", [npm, "run", "check"], cwd=CLOUDFLARE)

    save_release_pass()
    print("\n[RELEASE GATE PASS] Every mandatory release layer ran and passed."); return 0


if __name__ == "__main__": raise SystemExit(main())
