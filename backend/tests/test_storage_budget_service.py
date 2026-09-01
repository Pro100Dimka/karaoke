from types import SimpleNamespace
from unittest.mock import Mock

import pytest

from app.services import storage_budget_service as storage


def test_reservations_account_for_concurrent_promises_on_same_volume(monkeypatch, tmp_path):
    monkeypatch.setattr(storage, "_reservations", {})
    monkeypatch.setattr(storage, "_safety_margin", Mock(return_value=100))
    monkeypatch.setattr(storage.shutil, "disk_usage", Mock(return_value=SimpleNamespace(free=1_000)))
    monkeypatch.setattr(storage, "_volume_key", Mock(return_value="volume"))

    first = storage.reserve("first", tmp_path, 500)
    with pytest.raises(storage.InsufficientStorageError) as blocked:
        storage.reserve("second", tmp_path, 400, reclaimable_bytes=50)

    assert blocked.value.required_bytes == 500
    assert blocked.value.free_bytes == 400
    assert blocked.value.reclaimable_bytes == 50
    assert storage.snapshot()["reserved_bytes_by_volume"] == {"volume": 600}

    first.consume(250)
    assert storage.snapshot()["reserved_bytes_by_volume"] == {"volume": 350}

    first.release()
    second = storage.reserve("second", tmp_path, 400)
    second.release()
    assert storage.snapshot()["count"] == 0


def test_reserve_many_rolls_back_earlier_volume_on_failure(monkeypatch, tmp_path):
    first = Mock()
    error = storage.InsufficientStorageError(
        "second", tmp_path, required=2, free=1, reclaimable=0
    )
    monkeypatch.setattr(storage, "reserve", Mock(side_effect=[first, error]))

    with pytest.raises(storage.InsufficientStorageError):
        storage.reserve_many([("first", tmp_path, 1), ("second", tmp_path, 2)])

    first.release.assert_called_once_with()


def test_processing_and_recording_estimators_are_conservative(tmp_path):
    source = tmp_path / "source.mp3"
    source.write_bytes(b"x" * 1024)

    assert storage.processing_bytes(source) >= 2 * storage.GIB
    assert storage.processing_bytes(source, reuse_vocals=True) >= 512 * storage.MIB
    assert storage.recording_bytes(48_000, 2, 60) >= 48_000 * 2 * 3 * 60
