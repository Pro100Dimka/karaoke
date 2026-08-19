

import ast
from collections import Counter
from dataclasses import dataclass
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
BACKEND = ROOT / "backend"
EXCLUDED_PARTS = {"tests", "venv", "engines", "__pycache__"}


@dataclass(frozen=True, slots=True)
class Finding: path: str; line: int; kind: str; detail: str


class SemanticVisitor(ast.NodeVisitor):
    def __init__(self, path: Path): self.path = path; self.findings: list[Finding] = []; self.parents: list[ast.AST] = []

    def report(self, node: ast.AST, kind: str, detail: str) -> None: self.findings.append(Finding(self.path.relative_to(ROOT).as_posix(), getattr(node, 'lineno', 1), kind, detail))

    def visit(self, node: ast.AST) -> None: self.parents.append(node); super().visit(node); self.parents.pop()

    def visit_BoolOp(self, node: ast.BoolOp) -> None:
        comparisons = [value for value in node.values if isinstance(value, ast.Compare)]
        if isinstance(node.op, ast.Or) and len(comparisons) >= 3: self.report(node, "membership", f"{len(comparisons)} OR comparisons")
        self.generic_visit(node)

    def visit_For(self, node: ast.For) -> None:
        call = node.iter if isinstance(node.iter, ast.Call) else None
        if (
            call
            and isinstance(call.func, ast.Name)
            and call.func.id == "range"
            and call.args
            and isinstance(call.args[0], ast.Call)
            and isinstance(call.args[0].func, ast.Name)
            and call.args[0].func.id == "len"
        ):
            self.report(node, "enumerate-zip", "range(len(...)) loop")
        if len(node.body) == 1 and isinstance(node.body[0], (ast.If, ast.Expr)): self.report(node, "comprehension", "simple collection loop")
        self.generic_visit(node)

    def visit_If(self, node: ast.If) -> None:
        depth = sum(isinstance(parent, ast.If) for parent in self.parents[:-1])
        if depth >= 2: self.report(node, "guard-clause", f"nested if depth {depth + 1}")
        self.generic_visit(node)

    def visit_FunctionDef(self, node: ast.FunctionDef) -> None:
        if (
            len(node.body) == 1
            and isinstance(node.body[0], ast.Return)
            and isinstance(node.body[0].value, ast.Call)
        ):
            self.report(node, "wrapper", "single-call forwarding function")
        boolean_defaults = sum(
            isinstance(default, ast.Constant) and isinstance(default.value, bool)
            for default in (*node.args.defaults, *node.args.kw_defaults)
            if default is not None
        )
        if boolean_defaults >= 2: self.report(node, "state-model", f"{boolean_defaults} boolean parameters")
        self.generic_visit(node)

    visit_AsyncFunctionDef = visit_FunctionDef

    def visit_Try(self, node: ast.Try) -> None:
        if node.finalbody and any(
            isinstance(item, ast.Expr)
            and isinstance(item.value, ast.Call)
            and isinstance(item.value.func, ast.Attribute)
            and item.value.func.attr in {"close", "release"}
            for item in node.finalbody
        ):
            self.report(node, "context-manager", "manual close/release in finally")
        self.generic_visit(node)


def python_files() -> list[Path]:
    roots = (BACKEND / "app", BACKEND / "AI")
    return sorted(
        path
        for root in roots
        for path in root.rglob("*.py")
        if not EXCLUDED_PARTS.intersection(path.relative_to(BACKEND).parts)
    )


def audit() -> list[Finding]:
    findings: list[Finding] = []
    for path in python_files():
        try: tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
        except (OSError, SyntaxError, UnicodeDecodeError): continue
        visitor = SemanticVisitor(path); visitor.visit(tree); findings.extend(visitor.findings)
    return findings


def main() -> None:
    findings = audit(); counts = Counter(finding.kind for finding in findings); print("Python semantic simplification audit (advisory):"); print(f"Candidates: {len(findings)}")
    for kind, count in sorted(counts.items()): print(f"- {kind}: {count}")
    for finding in findings[:40]: print(f"  {finding.path}:{finding.line} [{finding.kind}] {finding.detail}")
    if len(findings) > 40: print(f"  ...and {len(findings) - 40} more")


if __name__ == "__main__": main()
