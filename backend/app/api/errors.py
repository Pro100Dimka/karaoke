"""Shared exception-to-HTTPException mapping for routers."""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager

from fastapi import HTTPException


@contextmanager
def http_error(exc_type: type[Exception] | tuple[type[Exception], ...], status_code: int) -> Iterator[None]:
    """Catch *exc_type* and re-raise it as an ``HTTPException`` with the same message.

    Centralizes the ``except X as exc: raise HTTPException(status_code=N, detail=str(exc))
    from exc`` pattern repeated verbatim across routers. Call sites that pair the mapping
    with extra cleanup before re-raising keep their own explicit try/except -- this helper
    is only for the plain catch-and-reraise contract.
    """
    try:
        yield
    except exc_type as exc:
        raise HTTPException(status_code=status_code, detail=str(exc)) from exc
