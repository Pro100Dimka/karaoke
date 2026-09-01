from __future__ import annotations

import importlib.util
from datetime import date
from pathlib import Path

import pytest

SCRIPT = Path(__file__).resolve().parents[2] / "scripts/frontend_dependency_audit.py"


def _module():
    spec = importlib.util.spec_from_file_location("frontend_dependency_audit_test", SCRIPT)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_high_vulnerability_requires_matching_unexpired_exception():
    module = _module()
    audit = {
        "vulnerabilities": {
            "electron": {
                "severity": "high",
                "via": [{"source": 1234, "severity": "high", "title": "example", "url": "https://example.test"}],
            }
        }
    }
    findings = module.blocking_findings(audit)
    assert findings == [
        {
            "package": "electron",
            "advisory": "1234",
            "severity": "high",
            "title": "example",
            "url": "https://example.test",
        }
    ]
    assert module.apply_policy(findings, [])[1] == findings

    exception = {
        "package": "electron",
        "advisory": "1234",
        "owner": "security@example.test",
        "reason": "temporary mitigation",
        "expires": "2099-01-01",
    }
    active = module.active_exceptions({"schema": 1, "exceptions": [exception]}, today=date(2026, 9, 1))
    allowed, unresolved = module.apply_policy(findings, active)
    assert allowed[0]["exception"] == exception
    assert unresolved == []


def test_expired_or_incomplete_exception_fails_closed():
    module = _module()
    with pytest.raises(ValueError, match="Expired"):
        module.active_exceptions(
            {
                "schema": 1,
                "exceptions": [
                    {
                        "package": "electron",
                        "advisory": "1234",
                        "owner": "security@example.test",
                        "reason": "temporary mitigation",
                        "expires": "2026-08-31",
                    }
                ],
            },
            today=date(2026, 9, 1),
        )
