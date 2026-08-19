import asyncio
from io import BytesIO
from types import SimpleNamespace

import pytest
from fastapi import HTTPException, UploadFile

from app.utils import atomic_files
from app.utils.atomic_files import atomic_write, atomic_write_bytes
from app.utils.files import read_text_tail
from app.utils.json_values import parse_json_value
from app.utils.quarantine import (
    existing_unique_paths,
    purge_quarantined_paths,
    quarantine_paths,
    restore_quarantined_paths,
)
from app.utils.uploads import read_upload_limited, save_upload_limited
from tests._shared import assert_http_status, raises


def upload_file(payload: bytes) -> UploadFile: return UploadFile(filename='payload.bin', file=BytesIO(payload))


def test_atomic_write_publishes_complete_payload_and_cleans_failure(tmp_path):
    destination = tmp_path / "nested" / "value.bin"
    atomic_write_bytes(destination, b"complete")
    assert destination.read_bytes() == b"complete"

    def fail(stream):
        stream.write(b"partial")
        raise RuntimeError("stop")

    raises(RuntimeError, lambda: atomic_write(destination, fail), match='stop')
    assert (destination.read_bytes() == b'complete') and (not list(destination.parent.glob('*.tmp')))


def test_directory_sync_closes_descriptor_and_suppresses_os_errors(monkeypatch, tmp_path):
    calls = []
    fake_os = SimpleNamespace(
        name="posix",
        O_RDONLY=0,
        open=lambda path, flags: calls.append((path, flags)) or 7,
        fsync=lambda descriptor: calls.append(("sync", descriptor)),
        close=lambda descriptor: calls.append(("close", descriptor)),
    )
    monkeypatch.setattr(atomic_files, "os", fake_os)
    atomic_files._sync_directory(tmp_path)
    assert calls == [(tmp_path, 0), ("sync", 7), ("close", 7)]

    fake_os.open = lambda *_args: (_ for _ in ()).throw(OSError("unsupported"))
    atomic_files._sync_directory(tmp_path)


def test_text_tail_respects_line_and_byte_limits(tmp_path):
    path = tmp_path / "log.txt"
    path.write_text("one\ntwo\nthree\nfour\n", encoding="utf-8")

    assert (read_text_tail(path, max_lines=2) == ['three', 'four']) and (read_text_tail(path, max_lines=10, max_bytes=6) == ['four']) and (read_text_tail(path, max_lines=10, max_bytes=5) == ['four']) and (read_text_tail(path, max_lines=0) == []) and (read_text_tail(path, max_bytes=0) == [])


@pytest.mark.parametrize(
    ("value", "default", "expected"),
    [
        ('{"ok": true}', {}, {"ok": True}),
        ("0", 5, 0),
        (None, [], []),
        ("{", {"safe": True}, {"safe": True}),
    ],
)
def test_parse_json_value_is_safe(value, default, expected):
    assert parse_json_value(value, default) == expected


def test_quarantine_can_restore_or_purge_files_and_directories(tmp_path):
    file_path, directory = tmp_path / 'file.txt', tmp_path / 'directory'
    nested = directory / "nested.txt"
    file_path.write_text("file", encoding="utf-8")
    directory.mkdir()
    nested.write_text("nested", encoding="utf-8")

    assert existing_unique_paths([file_path, file_path, tmp_path / "missing"]) == (file_path,)
    quarantined = quarantine_paths([file_path, directory])
    assert not file_path.exists() and not directory.exists()
    restore_quarantined_paths(quarantined)
    assert (file_path.read_text(encoding='utf-8') == 'file') and (nested.read_text(encoding='utf-8') == 'nested')

    quarantined = quarantine_paths([file_path, directory])
    purge_quarantined_paths(quarantined)
    assert not any(path.exists() for path in quarantined.values())


def test_quarantine_rolls_back_when_a_later_move_fails(monkeypatch, tmp_path):
    first, second = tmp_path / 'first', tmp_path / 'second'
    first.write_text("one", encoding="utf-8")
    second.write_text("two", encoding="utf-8")
    original_replace = type(first).replace

    def replace(path, target):
        if path == second: raise OSError("locked")
        return original_replace(path, target)

    monkeypatch.setattr(type(first), "replace", replace)
    raises(OSError, lambda: quarantine_paths([first, second]), match='locked')
    assert (first.read_text(encoding='utf-8') == 'one') and (second.read_text(encoding='utf-8') == 'two')


def test_bounded_upload_read_and_save(tmp_path):
    run = asyncio.run
    assert run(read_upload_limited(upload_file(b"abcdef"), limit=6, chunk_size=2)) == b"abcdef"
    assert_http_status(413, lambda: run(read_upload_limited(upload_file(b"abcdef"), limit=5, chunk_size=2)))

    destination = tmp_path / "uploads" / "payload.bin"
    assert (run(save_upload_limited(upload_file(b'abcdef'), destination, limit=6, chunk_size=2)) == 6) and (destination.read_bytes() == b'abcdef')

    raises(HTTPException, lambda: run(save_upload_limited(upload_file(b'abcdef'), destination, limit=5, chunk_size=2)))
    assert not destination.exists()


@pytest.mark.parametrize(("limit", "chunk_size"), [(-1, 1), (1, 0)])
def test_upload_limits_reject_invalid_configuration(limit, chunk_size, tmp_path):
    raises(ValueError, lambda: asyncio.run(read_upload_limited(upload_file(b'x'), limit=limit, chunk_size=chunk_size)), match='Upload limit')
    raises(ValueError, lambda: asyncio.run(save_upload_limited(upload_file(b'x'), tmp_path / 'value', limit=limit, chunk_size=chunk_size)), match='Upload limit')
