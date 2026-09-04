from __future__ import annotations

import json
import subprocess
import sys
from datetime import UTC, date, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
ALLOWLIST = ROOT / "scripts/security/backend-audit-allowlist.json"
REPORT = ROOT / "generated/tests/security/backend-pip-audit.json"


def active_exceptions(document: dict, *, today: date) -> list[dict]:
    if document.get("schema") != 1:
        raise ValueError("Backend audit allowlist must use schema 1")
    active = []
    for exception in document.get("exceptions", []):
        missing = [field for field in ("package", "advisory", "owner", "reason", "expires") if not exception.get(field)]
        if missing:
            raise ValueError("Backend audit exception is missing: " + ", ".join(missing))
        expires = date.fromisoformat(exception["expires"])
        if expires < today:
            raise ValueError(
                f"Expired backend audit exception for {exception['package']} / {exception['advisory']}"
            )
        active.append(exception)
    return active


def findings(audit: dict) -> list[dict]:
    return [
        {
            "package": dependency["name"],
            "installed_version": dependency.get("version"),
            **vulnerability,
        }
        for dependency in audit.get("dependencies", [])
        for vulnerability in dependency.get("vulns", [])
    ]


def main() -> int:
    exceptions = active_exceptions(
        json.loads(ALLOWLIST.read_text(encoding="utf-8")), today=datetime.now(UTC).date()
    )
    process = subprocess.run(
        [sys.executable, "-m", "pip_audit", "--format", "json"],
        cwd=BACKEND,
        text=True,
        capture_output=True,
        check=False,
    )
    try:
        audit = json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"pip-audit did not return JSON: {process.stderr.strip()}") from error

    allowed, unresolved = [], []
    for finding in findings(audit):
        exception = next(
            (
                item
                for item in exceptions
                if item["package"] == finding["package"] and item["advisory"] == finding["id"]
            ),
            None,
        )
        target = allowed if exception else unresolved
        target.append({**finding, **({"exception": exception} if exception else {})})

    report = {
        "schema": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "pip_audit_exit_code": process.returncode,
        "allowed": allowed,
        "unresolved": unresolved,
        "audit": audit,
    }
    REPORT.parent.mkdir(parents=True, exist_ok=True)
    REPORT.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"Backend pip audit: {len(allowed) + len(unresolved)} findings, {len(allowed)} temporarily allowed")
    print(f"Report: {REPORT.relative_to(ROOT)}")
    for finding in unresolved:
        print(f"UNRESOLVED: {finding['package']} {finding['id']}", file=sys.stderr)
    return 1 if unresolved else 0


if __name__ == "__main__":
    raise SystemExit(main())
