from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from datetime import UTC, date, datetime
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
PROJECTS = {
    "frontend": (
        ROOT / "front",
        ROOT / "scripts/security/frontend-audit-allowlist.json",
    ),
    "cloudflare": (
        ROOT / "cloudflare",
        ROOT / "scripts/security/cloudflare-audit-allowlist.json",
    ),
}
REPORT_DIR = ROOT / "generated/tests/security"
BLOCKING_SEVERITIES = {"high", "critical"}


def blocking_findings(audit: dict) -> list[dict]:
    findings: list[dict] = []
    for package, vulnerability in audit.get("vulnerabilities", {}).items():
        if vulnerability.get("severity") not in BLOCKING_SEVERITIES:
            continue
        advisories = [item for item in vulnerability.get("via", []) if isinstance(item, dict)]
        if not advisories:
            advisories = [{"source": package, "name": package, "url": ""}]
        for advisory in advisories:
            severity = advisory.get("severity", vulnerability.get("severity"))
            if severity not in BLOCKING_SEVERITIES:
                continue
            findings.append(
                {
                    "package": package,
                    "advisory": str(advisory.get("source", package)),
                    "severity": severity,
                    "title": advisory.get("title", vulnerability.get("name", package)),
                    "url": advisory.get("url", ""),
                }
            )
    return findings


def active_exceptions(document: dict, *, today: date) -> list[dict]:
    if document.get("schema") != 1:
        raise ValueError("Frontend audit allowlist must use schema 1")
    active = []
    for exception in document.get("exceptions", []):
        missing = [field for field in ("package", "advisory", "owner", "reason", "expires") if not exception.get(field)]
        if missing:
            raise ValueError("Frontend audit exception is missing: " + ", ".join(missing))
        try:
            expires = date.fromisoformat(exception["expires"])
        except ValueError as error:
            raise ValueError(f"Invalid audit exception expiry: {exception['expires']!r}") from error
        if expires < today:
            raise ValueError(
                f"Expired frontend audit exception for {exception['package']} / {exception['advisory']}"
            )
        active.append(exception)
    return active


def apply_policy(findings: list[dict], exceptions: list[dict]) -> tuple[list[dict], list[dict]]:
    allowed, unresolved = [], []
    for finding in findings:
        exception = next(
            (
                item
                for item in exceptions
                if item["package"] == finding["package"]
                and str(item["advisory"]) == finding["advisory"]
            ),
            None,
        )
        (allowed if exception else unresolved).append(
            {**finding, **({"exception": exception} if exception else {})}
        )
    return allowed, unresolved


def run_audit(scope: str, workspace: Path) -> tuple[int, dict]:
    npm = shutil.which("npm.cmd" if os.name == "nt" else "npm")
    if not npm:
        raise RuntimeError("npm is required for the frontend dependency audit")
    command = [npm, "audit", "--json"]
    if scope == "production":
        command.insert(2, "--omit=dev")
    process = subprocess.run(command, cwd=workspace, text=True, capture_output=True, check=False)
    try:
        return process.returncode, json.loads(process.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"npm audit did not return JSON: {process.stderr.strip()}") from error


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--project", choices=tuple(PROJECTS), default="frontend")
    parser.add_argument("--scope", choices=("production", "all"), required=True)
    args = parser.parse_args()

    workspace, allowlist_path = PROJECTS[args.project]
    allowlist = json.loads(allowlist_path.read_text(encoding="utf-8"))
    exceptions = active_exceptions(allowlist, today=datetime.now(UTC).date())
    command_code, audit = run_audit(args.scope, workspace)
    findings = blocking_findings(audit)
    allowed, unresolved = apply_policy(findings, exceptions)
    report = {
        "schema": 1,
        "generated_at": datetime.now(UTC).isoformat(),
        "scope": args.scope,
        "npm_exit_code": command_code,
        "allowed": allowed,
        "unresolved": unresolved,
        "audit": audit,
    }
    REPORT_DIR.mkdir(parents=True, exist_ok=True)
    report_path = REPORT_DIR / f"{args.project}-npm-audit-{args.scope}.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(f"{args.project} npm audit ({args.scope}): {len(findings)} High/Critical, {len(allowed)} allowed")
    print(f"Report: {report_path.relative_to(ROOT)}")
    if unresolved:
        for finding in unresolved:
            print(
                f"UNRESOLVED: {finding['severity']} {finding['package']} advisory={finding['advisory']} {finding['url']}",
                file=sys.stderr,
            )
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
