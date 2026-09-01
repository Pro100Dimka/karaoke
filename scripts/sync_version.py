from __future__ import annotations

import argparse
import json
import os
import re
import tempfile
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
VERSION_FILE = ROOT / "VERSION"
SEMVER = re.compile(r"\d+\.\d+\.\d+")


def _version(value: str) -> str:
    value = value.strip()
    if not SEMVER.fullmatch(value):
        raise ValueError(f"Version must use major.minor.patch form, got {value!r}")
    return value


def _json_version(path: Path, version: str) -> bytes:
    document = json.loads(path.read_text(encoding="utf-8"))
    document["version"] = version
    if "packages" in document and "" in document["packages"]:
        document["packages"][""]["version"] = version
    return (json.dumps(document, ensure_ascii=False, indent=2) + "\n").encode("utf-8")


def _replace_version(path: Path, pattern: str, replacement: str) -> bytes:
    source = path.read_text(encoding="utf-8")
    updated, count = re.subn(pattern, replacement, source, count=1, flags=re.MULTILINE)
    if count != 1:
        raise ValueError(f"Could not locate the version field in {path.relative_to(ROOT)}")
    return updated.encode("utf-8")


def rendered_files(version: str) -> dict[Path, bytes]:
    version = _version(version)
    return {
        VERSION_FILE: f"{version}\n".encode(),
        ROOT / "front/package.json": _json_version(ROOT / "front/package.json", version),
        ROOT / "front/package-lock.json": _json_version(ROOT / "front/package-lock.json", version),
        ROOT / "backend/pyproject.toml": _replace_version(
            ROOT / "backend/pyproject.toml",
            r'^(version\s*=\s*")[^"]+("\s*)$',
            rf"\g<1>{version}\g<2>",
        ),
        ROOT / "backend/app/version.py": _replace_version(
            ROOT / "backend/app/version.py",
            r'^(APP_VERSION\s*=\s*")[^"]+("\s*)$',
            rf"\g<1>{version}\g<2>",
        ),
        ROOT / "cloudflare/package.json": _json_version(
            ROOT / "cloudflare/package.json", version
        ),
        ROOT / "cloudflare/package-lock.json": _json_version(
            ROOT / "cloudflare/package-lock.json", version
        ),
    }


def check(version: str) -> list[str]:
    version = _version(version)
    mismatches: list[str] = []

    def compare(path: Path, values: list[str]) -> None:
        if any(value != version for value in values):
            mismatches.append(path.relative_to(ROOT).as_posix())

    if not VERSION_FILE.is_file() or VERSION_FILE.read_text(encoding="utf-8").strip() != version:
        mismatches.append("VERSION")
    for relative in (
        "front/package.json",
        "front/package-lock.json",
        "cloudflare/package.json",
        "cloudflare/package-lock.json",
    ):
        path = ROOT / relative
        if not path.is_file():
            mismatches.append(relative)
            continue
        document = json.loads(path.read_text(encoding="utf-8"))
        values = [str(document.get("version", ""))]
        if "packages" in document and "" in document["packages"]:
            values.append(str(document["packages"][""].get("version", "")))
        compare(path, values)

    for relative, pattern in (
        ("backend/pyproject.toml", r'^version\s*=\s*"([^"]+)"\s*$'),
        (
            "backend/app/version.py",
            r'^APP_VERSION\s*=\s*"([^"]+)"\s*$',
        ),
    ):
        path = ROOT / relative
        if not path.is_file():
            mismatches.append(relative)
            continue
        match = re.search(pattern, path.read_text(encoding="utf-8"), re.MULTILINE)
        compare(path, [match.group(1) if match else ""])
    return mismatches


def write_transaction(files: dict[Path, bytes]) -> None:
    originals = {path: path.read_bytes() if path.exists() else None for path in files}
    temporary: dict[Path, Path] = {}
    replaced: list[Path] = []
    try:
        for path, payload in files.items():
            path.parent.mkdir(parents=True, exist_ok=True)
            descriptor, name = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
            with os.fdopen(descriptor, "wb") as stream:
                stream.write(payload)
                stream.flush()
                os.fsync(stream.fileno())
            temporary[path] = Path(name)
        for path, staged in temporary.items():
            os.replace(staged, path)
            replaced.append(path)
    except BaseException:
        for path in reversed(replaced):
            original = originals[path]
            if original is None:
                path.unlink(missing_ok=True)
            else:
                path.write_bytes(original)
        raise
    finally:
        for staged in temporary.values():
            staged.unlink(missing_ok=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Synchronize every A&D Voice version mirror")
    action = parser.add_mutually_exclusive_group(required=True)
    action.add_argument("--check", action="store_true")
    action.add_argument("--set", metavar="MAJOR.MINOR.PATCH")
    args = parser.parse_args()

    if args.set:
        version = _version(args.set)
        write_transaction(rendered_files(version))
        print(f"Synchronized A&D Voice version {version}")
        return 0

    if not VERSION_FILE.is_file():
        print("Version consistency check failed: VERSION is missing")
        return 1
    version = _version(VERSION_FILE.read_text(encoding="utf-8"))
    mismatches = check(version)
    if mismatches:
        print(f"Version consistency check failed; VERSION contains {version}, but these files differ:")
        for mismatch in mismatches:
            print(f"- {mismatch}")
        return 1
    print(f"Version consistency check passed: {version}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
