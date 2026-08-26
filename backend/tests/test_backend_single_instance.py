import logging
from io import StringIO
from pathlib import Path
from unittest.mock import Mock

import run


def test_single_instance_lock_rejects_second_holder(tmp_path: Path):
    path = tmp_path / "backend.lock"
    first, second = run._SingleInstanceLock(path), run._SingleInstanceLock(path)
    assert first.acquire() is True
    try:
        assert second.acquire() is False
    finally:
        first.release()
    assert second.acquire() is True
    second.release()


def test_existing_backend_health_returns_false_for_closed_port(monkeypatch):
    class ClosedSocket:
        def __enter__(self): raise OSError('closed')
        def __exit__(self, *_args): return False

    monkeypatch.setattr(run.socket, "create_connection", lambda *_args, **_kwargs: ClosedSocket())
    assert run._existing_backend_is_healthy("127.0.0.1", 1) is False


def test_raw_info_stream_stays_local_even_for_ai_progress():
    local, remote, output = Mock(), Mock(), StringIO()
    stream = run._StreamToLogFile(local, remote, logging.INFO, output)

    stream.write("ordinary info\n[AI] melody extraction\n")

    assert local.handle.call_count == 2
    remote.handle.assert_not_called()


def test_raw_error_stream_is_forwarded_to_remote():
    local, remote = Mock(), Mock()
    stream = run._StreamToLogFile(local, remote, logging.ERROR, StringIO())

    stream.write("backend crashed\n")

    remote.handle.assert_called_once()


def test_legacy_log_cleanup_keeps_rotated_backups_of_the_active_file(tmp_path):
    log_path = tmp_path / "application.log"
    log_path.write_text("current")
    backup = tmp_path / "application.log.1"
    backup.write_text("rotated backup")
    unrelated = tmp_path / "old-crash.log"
    unrelated.write_text("stale")
    directory = tmp_path / "logs-subdir"
    directory.mkdir()

    assert run._is_unrelated_legacy_log(log_path, log_path) is False
    assert run._is_unrelated_legacy_log(backup, log_path) is False
    assert run._is_unrelated_legacy_log(unrelated, log_path) is True
    assert run._is_unrelated_legacy_log(directory, log_path) is False  # not a file at all


def test_redact_log_text_hides_the_api_token_bearer_tokens_and_home_paths(monkeypatch):
    monkeypatch.setenv("SONGAPP_API_TOKEN", "s3cr3t-token-value")

    assert run._redact_log_text("auth failed for token s3cr3t-token-value") == (
        "auth failed for token <redacted-token>"
    )
    assert run._redact_log_text("Authorization: Bearer abcdEFGH12345678") == (
        "Authorization: Bearer <redacted>"
    )
    assert run._redact_log_text(r"reading C:\Users\Dmitriy\AppData\song.wav") == (
        r"reading C:\Users\<user>\AppData\song.wav"
    )
    assert run._redact_log_text("reading /home/dmitriy/library/song.wav") == (
        "reading /home/<user>/library/song.wav"
    )
    assert run._redact_log_text("no secrets here") == "no secrets here"


def test_redacting_formatter_scrubs_the_final_formatted_line(monkeypatch):
    monkeypatch.setenv("SONGAPP_API_TOKEN", "s3cr3t-token-value")
    formatter = run._RedactingFormatter("%(message)s")
    record = logging.LogRecord("test", logging.ERROR, __file__, 1, "token=%s", ("s3cr3t-token-value",), None)

    assert formatter.format(record) == "token=<redacted-token>"
