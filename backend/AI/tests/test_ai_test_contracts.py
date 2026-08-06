from __future__ import annotations

import ast
from pathlib import Path

AI_ROOT = Path(__file__).resolve().parents[1]
SRC_ROOT = AI_ROOT / "src"


def _python_files():
    return [p for p in SRC_ROOT.rglob("*.py") if "__pycache__" not in p.parts]


def test_every_ai_module_is_syntax_valid():
    for path in _python_files():
        ast.parse(path.read_text(encoding="utf-8"), filename=str(path))


def test_ai_source_has_no_bare_except_or_mutable_defaults():
    issues = []
    for path in _python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ExceptHandler) and node.type is None:
                issues.append(f"{path}: bare except")
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                defaults = [*node.args.defaults, *node.args.kw_defaults]
                for default in defaults:
                    if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                        issues.append(f"{path}:{node.lineno}: mutable default")
    assert issues == []


def test_ai_modules_do_not_import_backend_routers():
    violations = []
    for path in _python_files():
        tree = ast.parse(path.read_text(encoding="utf-8"))
        for node in ast.walk(tree):
            if isinstance(node, ast.ImportFrom) and node.module and node.module.startswith("app.routers"):
                violations.append(str(path))
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name.startswith("app.routers"):
                        violations.append(str(path))
    assert violations == []
