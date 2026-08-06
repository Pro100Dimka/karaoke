"""Bounded helpers for user supplied uploads."""

from __future__ import annotations

import os
from pathlib import Path

from fastapi import HTTPException, UploadFile


async def read_upload_limited(
    upload: UploadFile,
    *,
    limit: int,
    chunk_size: int,
    too_large_message: str = "Uploaded file is too large",
) -> bytes:
    """Read an upload incrementally and reject payloads above *limit*."""
    payload = bytearray()
    while chunk := await upload.read(chunk_size):
        if len(payload) + len(chunk) > limit:
            raise HTTPException(status_code=413, detail=too_large_message)
        payload.extend(chunk)
    return bytes(payload)


async def save_upload_limited(
    upload: UploadFile,
    destination: Path,
    *,
    limit: int,
    chunk_size: int,
    too_large_message: str = "Uploaded file is too large",
) -> int:
    """Stream an upload to disk and remove a partial file on failure."""
    destination.parent.mkdir(parents=True, exist_ok=True)
    received = 0
    try:
        with destination.open("wb") as stream:
            while chunk := await upload.read(chunk_size):
                received += len(chunk)
                if received > limit:
                    raise HTTPException(status_code=413, detail=too_large_message)
                stream.write(chunk)
            stream.flush()
            os.fsync(stream.fileno())
    except Exception:
        destination.unlink(missing_ok=True)
        raise
    return received
