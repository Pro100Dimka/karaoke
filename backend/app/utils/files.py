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
    if max_lines <= 0 or max_bytes <= 0:
        return []
    with path.open("rb") as stream:
        stream.seek(0, 2)
        # Read one extra byte so a Windows CRLF delimiter does not consume one
        # byte of the requested tail budget and make the final complete line
        # look truncated (for example ``four\r\n`` with ``max_bytes=5``).
        # The helper remains strictly bounded: at most max_bytes + 2 bytes are
        # inspected including the one-byte boundary look-behind below.
        start = max(0, stream.tell() - (max_bytes + 1))
        previous = b""
        if start:
            stream.seek(start - 1)
            previous = stream.read(1)
        stream.seek(start)
        content = stream.read()
    lines = content.decode(encoding, errors="replace").splitlines()
    if start > 0 and content[:1] in {b"\n", b"\r"} and lines and lines[0] == "":
        # A delimiter at the beginning of the bounded window terminates the
        # preceding line; it is not itself an empty tail line.
        lines = lines[1:]
    elif start > 0 and previous not in {b"\n", b"\r"}:
        # The first decoded line is only a suffix of a line that began before
        # the bounded window, so never expose it as a complete log line.
        lines = lines[1:]
    return lines[-max_lines:]
