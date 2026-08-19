from pathlib import Path

import run


def test_single_instance_lock_rejects_second_holder(tmp_path: Path):
    path = tmp_path / "backend.lock"; first, second = run._SingleInstanceLock(path), run._SingleInstanceLock(path); assert first.acquire() is True
    try: assert second.acquire() is False
    finally: first.release()
    assert second.acquire() is True; second.release()


def test_existing_backend_health_returns_false_for_closed_port(monkeypatch):
    class ClosedSocket:
        def __enter__(self): raise OSError('closed')
        def __exit__(self, *_args): return False

    monkeypatch.setattr(run.socket, "create_connection", lambda *_args, **_kwargs: ClosedSocket()); assert run._existing_backend_is_healthy("127.0.0.1", 1) is False
