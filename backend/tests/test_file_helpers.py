import asyncio
import io
import json
from pathlib import Path

import pytest
from fastapi import HTTPException, UploadFile

from app.utils.files import read_text_tail
from app.utils.json_files import read_json, write_json
from app.utils.uploads import read_upload_limited, save_upload_limited


def make_upload(data: bytes, filename: str = "file.bin") -> UploadFile:
    return UploadFile(filename=filename, file=io.BytesIO(data))


def test_read_upload_limited_accepts_exact_limit() -> None:
    upload = make_upload(b"abcd")
    result = asyncio.run(read_upload_limited(upload, limit=4, chunk_size=2))
    assert result == b"abcd"


def test_read_upload_limited_rejects_oversized_payload() -> None:
    upload = make_upload(b"abcde")
    with pytest.raises(HTTPException) as exc_info:
        asyncio.run(read_upload_limited(upload, limit=4, chunk_size=2))
    assert exc_info.value.status_code == 413


def test_save_upload_limited_streams_file(tmp_path: Path) -> None:
    destination = tmp_path / "upload.bin"
    size = asyncio.run(
        save_upload_limited(make_upload(b"abcdef"), destination, limit=6, chunk_size=2)
    )
    assert size == 6
    assert destination.read_bytes() == b"abcdef"


def test_save_upload_limited_removes_partial_file_on_overflow(tmp_path: Path) -> None:
    destination = tmp_path / "upload.bin"
    with pytest.raises(HTTPException):
        asyncio.run(save_upload_limited(make_upload(b"abcdef"), destination, limit=5, chunk_size=2))
    assert not destination.exists()


def test_write_json_is_utf8_and_readable(tmp_path: Path) -> None:
    path = tmp_path / "nested" / "data.json"
    payload = {"title": "Пісня", "items": [1, 2, 3]}
    write_json(path, payload)
    assert read_json(path) == payload
    assert json.loads(path.read_text(encoding="utf-8")) == payload
    assert not path.with_suffix(".json.tmp").exists()


def test_read_json_returns_default_for_missing_file(tmp_path: Path) -> None:
    assert read_json(tmp_path / "missing.json", default={"ok": True}) == {"ok": True}


def test_read_log_tail_is_bounded_by_lines(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.log"
    path.write_text("\n".join(f"line-{i}" for i in range(20)), encoding="utf-8")
    assert read_text_tail(path, max_lines=3) == ["line-17", "line-18", "line-19"]


def test_read_log_tail_replaces_invalid_utf8(tmp_path: Path) -> None:
    path = tmp_path / "pipeline.log"
    path.write_bytes(b"ok\n\xffbad")
    lines = read_text_tail(path)
    assert lines[0] == "ok"
    assert "bad" in lines[1]
