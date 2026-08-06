"""Bounded filesystem helpers for application-owned text files."""

from pathlib import Path


def read_text_tail(
    path: Path,
    *,
    max_lines: int = 500,
    max_bytes: int = 1_000_000,
    encoding: str = "utf-8",
) -> list[str]:
    """Return a bounded tail without loading an arbitrarily large file."""
    with path.open("rb") as stream:
        stream.seek(0, 2)
        stream.seek(max(0, stream.tell() - max_bytes))
        content = stream.read()
    return content.decode(encoding, errors="replace").splitlines()[-max_lines:]
