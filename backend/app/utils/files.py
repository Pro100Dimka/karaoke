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
    if max_lines <= 0 or max_bytes <= 0: return []
    with path.open("rb") as stream:
        stream.seek(0, 2)
        start = max(0, stream.tell() - (max_bytes + 1))
        previous = b""
        if start:
            stream.seek(start - 1)
            previous = stream.read(1)
        stream.seek(start)
        content = stream.read()
    lines = content.decode(encoding, errors="replace").splitlines()
    # start > 0 means truncation happened. If `previous` (the byte right
    # before start) isn't itself a newline, start landed mid-line: whatever
    # splitlines() decoded as the first element -- empty or not -- is a
    # fragment of a real line we don't have the rest of, so it must be
    # dropped. If `previous` IS a newline, start landed exactly on a real
    # line boundary and the first element (even an empty one -- a genuine
    # blank line in the file) is not a truncation artifact and must be kept
    # -- EXCEPT when previous is "\r" and the read itself starts with "\n":
    # that specific pair is one CRLF terminator split across the boundary,
    # not two separate line breaks, so the "line" splitlines() sees before
    # that "\n" is a phantom empty line, not real content.
    split_crlf = previous == b"\r" and content[:1] == b"\n"
    if start > 0 and (previous not in {b"\n", b"\r"} or split_crlf):
        lines = lines[1:]
    return lines[-max_lines:]
