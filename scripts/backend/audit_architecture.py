

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2] / "backend"
EXCLUDED_PARTS = {"AI", "AIOLD", "engines", "tests", ".venv", "venv"}
MAX_FUNCTION_LINES = 80
MAX_MODULE_LINES = 700

# Compatibility adapters necessarily assemble old payload formats in one place.
# Keep narrow, named exceptions visible instead of weakening the global rule.
FUNCTION_LINE_LIMITS = {
    (Path("app/services/ai_bridge.py"), "_repair_impossible_alignment_chunks"): 101,
    (Path("app/services/ai_bridge.py"), "_build_legacy_karaoke_timeline"): 130,
    (Path("app/services/app_settings_service.py"), "update_settings"): 83,
    (Path("app/services/audio_service.py"), "_configure_monitoring"): 86,
    (Path("app/services/audio_service.py"), "_launch_monitor_process"): 108,
    (Path("app/services/kar_dataset_service.py"), "_word_events"): 86,
    (Path("app/services/kar_dataset_service.py"), "_midi_audio_match"): 104,
    (Path("app/services/kar_dataset_service.py"), "_download_audio"): 149,
    (Path("app/services/kar_dataset_service.py"), "prepare_kar_file"): 127,
    (Path("app/services/kfn_dataset_service.py"), "prepare_kfn_file"): 167,
    (Path("app/services/pipeline_service.py"), "_run_job"): 83,
    (Path("app/services/recording_service.py"), "__init__"): 102,
    (Path("app/services/recording_service.py"), "start_recording"): 81,
    (Path("app/services/recording_service.py"), "stop_recording"): 87,
    (Path("app/services/recording_service.py"), "attach_room_audio"): 86,
    (Path("AI/engines/text.py"), "_align_timed_lines_local"): 130,
    (Path("AI/engines/text.py"), "_align_long_text_local"): 101,
}

MODULE_LINE_LIMITS = {
    Path("app/services/kar_dataset_service.py"): 1350,
    Path("AI/engines/text.py"): 1170,
    Path("app/services/pipeline_service.py"): 1180,
    Path("app/services/recording_service.py"): 1050,
    Path("app/services/audio_service.py"): 960,
    Path("app/services/song_package_service.py"): 890,
    Path("app/routers/songs.py"): 710,
}


def python_files() -> list[Path]:
    files = [
        path for path in ROOT.rglob("*.py")
        if not EXCLUDED_PARTS.intersection(path.relative_to(ROOT).parts)
    ]
    # The forced-alignment engine is a known production hotspot even though
    # third-party/legacy AI trees are intentionally excluded from this audit.
    files.append(ROOT / "AI" / "engines" / "text.py")
    return sorted(set(files))


def imported_module(node: ast.AST) -> str | None:
    if isinstance(node, ast.ImportFrom): return node.module
    if isinstance(node, ast.Import) and node.names: return node.names[0].name
    return None


# Names that indicate a function reaches out past its own process/memory --
# subprocess spawns, filesystem writes, network calls, threads. A long
# function that ALSO juggles several of these alongside its own branches and
# cleanup paths is a real extraction candidate; a long-but-linear function
# calling one such API isn't automatically one.
_SIDE_EFFECT_CALLEES = {
    "run", "Popen", "call", "check_call", "check_output",  # subprocess
    "Thread", "Process",  # threading/multiprocessing
    "open", "remove", "unlink", "rmtree", "move", "copyfile", "copy",  # filesystem
    "request", "get", "post", "put", "delete", "urlopen",  # network
}


def _function_complexity(node: ast.FunctionDef | ast.AsyncFunctionDef) -> dict[str, int]:
    branches = cleanup_paths = exit_points = side_effects = 0
    for child in ast.walk(node):
        if child is node:
            continue
        if isinstance(child, (ast.If, ast.For, ast.While, ast.Try)):
            branches += 1
        if isinstance(child, ast.Try) and child.finalbody:
            cleanup_paths += 1
        if isinstance(child, (ast.With, ast.AsyncWith)):
            cleanup_paths += 1
        if isinstance(child, (ast.Return, ast.Raise)):
            exit_points += 1
        if isinstance(child, ast.Call):
            callee = child.func.attr if isinstance(child.func, ast.Attribute) else getattr(child.func, "id", None)
            if callee in _SIDE_EFFECT_CALLEES:
                side_effects += 1
    return {
        "branches": branches,
        "cleanup_paths": cleanup_paths,
        "exit_points": exit_points,
        "side_effects": side_effects,
    }


# A function tripping at least this many of these four signals is doing
# enough at once that splitting it (or modelling it as an explicit state
# machine) is worth considering -- advisory, not a build-breaking rule.
_COMPLEXITY_SIGNAL_THRESHOLDS = {"branches": 8, "cleanup_paths": 2, "exit_points": 6, "side_effects": 3}
_COMPLEXITY_SIGNALS_TO_FLAG = 3


def audit_file(path: Path) -> tuple[list[str], list[str]]:
    relative = path.relative_to(ROOT)

    try:
        tree = ast.parse(
            path.read_text(encoding="utf-8"),
            filename=str(relative),
        )
    except (OSError, SyntaxError, UnicodeError) as exc: return [f"{relative}: cannot parse file: {exc}"], []

    errors: list[str] = []; warnings: list[str] = []; parts = relative.parts
    module_lines = len(path.read_text(encoding="utf-8").splitlines())
    module_limit = MODULE_LINE_LIMITS.get(relative, MAX_MODULE_LINES)
    if module_lines > module_limit:
        errors.append(
            f"{relative}: module has {module_lines} lines (budget {module_limit})"
        )

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

            if (
                parts[:2] == ("app", "routers")
                and (module == "AI" or module.startswith("AI."))
            ):
                errors.append(
                    f"{relative}:{node.lineno}: "
                    "router imports internal AI implementation directly "
                    "(go through a service, e.g. app.services.ai_bridge)"
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
                    f"(budget {limit})"
                )

            complexity = _function_complexity(node)
            signals_tripped = sum(
                1 for signal, count in complexity.items() if count >= _COMPLEXITY_SIGNAL_THRESHOLDS[signal]
            )
            if signals_tripped >= _COMPLEXITY_SIGNALS_TO_FLAG:
                detail = ", ".join(f"{signal}={count}" for signal, count in complexity.items())
                warnings.append(
                    f"{relative}:{node.lineno}: function {node.name!r} is doing a lot at once "
                    f"({detail}) -- consider extraction or an explicit state machine"
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

        if isinstance(node, ast.ExceptHandler) and node.type is None: errors.append(f"{relative}:{node.lineno}: bare except")

    return errors, warnings


def main() -> int:
    files = python_files()
    results = [audit_file(path) for path in files]
    errors = [error for file_errors, _ in results for error in file_errors]
    warnings = [warning for _, file_warnings in results for warning in file_warnings]

    if warnings:
        print("Architecture audit warnings (advisory, does not fail the build):")
        print("\n".join(f"- {warning}" for warning in warnings))

    if errors:
        print("Architecture audit failed:"); print("\n".join(f"- {error}" for error in errors)); return 1

    print(f"Architecture audit passed ({len(files)} Python files, {len(warnings)} advisory warning(s))."); return 0


if __name__ == "__main__": raise SystemExit(main())
