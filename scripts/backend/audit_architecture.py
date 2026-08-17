"""Lightweight architectural checks that do not require external tools."""

from __future__ import annotations

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "backend"
EXCLUDED_PARTS = {"AI", "engines", "tests", ".venv", "venv"}
MAX_FUNCTION_LINES = 80

# Compatibility adapters necessarily assemble old payload formats in one place.
# Keep narrow, named exceptions visible instead of weakening the global rule.
FUNCTION_LINE_LIMITS = {
    (Path("app/services/ai_bridge.py"), "_repair_impossible_alignment_chunks"): 101,
    (Path("app/services/ai_bridge.py"), "_build_legacy_karaoke_timeline"): 130,
}


def python_files() -> list[Path]:
    return [
        path
        for path in ROOT.rglob("*.py")
        if not EXCLUDED_PARTS.intersection(path.relative_to(ROOT).parts)
    ]


def imported_module(node: ast.AST) -> str | None:
    if isinstance(node, ast.ImportFrom):
        return node.module
    if isinstance(node, ast.Import) and node.names:
        return node.names[0].name
    return None


def audit_file(path: Path) -> list[str]:
    relative = path.relative_to(ROOT)

    try:
        tree = ast.parse(
            path.read_text(encoding="utf-8"),
            filename=str(relative),
        )
    except (OSError, SyntaxError, UnicodeError) as exc:
        return [f"{relative}: cannot parse file: {exc}"]

    errors: list[str] = []
    parts = relative.parts

    for node in ast.walk(tree):
        module = imported_module(node)

        if module:
            if (
                parts[:2] == ("app", "services")
                and module.startswith("app.routers")
            ):
                errors.append(
                    f"{relative}:{node.lineno}: service imports router"
                )

            if (
                parts[:2] == ("app", "utils")
                and module.startswith(("app.routers", "app.services"))
            ):
                errors.append(
                    f"{relative}:{node.lineno}: "
                    "utility imports upper application layer"
                )

        if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
            length = (node.end_lineno or node.lineno) - node.lineno + 1
            limit = FUNCTION_LINE_LIMITS.get(
                (relative, node.name),
                MAX_FUNCTION_LINES,
            )

            if length > limit:
                errors.append(
                    f"{relative}:{node.lineno}: "
                    f"function {node.name!r} has {length} lines "
                    f"(limit {limit})"
                )

            defaults = (*node.args.defaults, *node.args.kw_defaults)

            for default in defaults:
                if isinstance(default, (ast.List, ast.Dict, ast.Set)):
                    errors.append(
                        f"{relative}:{node.lineno}: "
                        f"function {node.name!r} uses a mutable default"
                    )

        if (
            isinstance(node, ast.ImportFrom)
            and any(alias.name == "*" for alias in node.names)
        ):
            errors.append(f"{relative}:{node.lineno}: wildcard import")

        if isinstance(node, ast.ExceptHandler) and node.type is None:
            errors.append(f"{relative}:{node.lineno}: bare except")

    return errors


def main() -> int:
    files = python_files()
    errors = [error for path in files for error in audit_file(path)]

    if errors:
        print("Architecture audit failed:")
        print("\n".join(f"- {error}" for error in errors))
        return 1

    print(f"Architecture audit passed ({len(files)} Python files).")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
