from datetime import UTC, datetime
from types import SimpleNamespace

import pytest

from app.routers import analysis as analysis_router
from app.services import resource_deletion
from app.utils.json_values import parse_json_value


class FakeDb:
    def __init__(self, commit_error=None):
        self.commit_error = commit_error
        self.deleted = []
        self.rollbacks = 0

    def delete(self, instance):
        self.deleted.append(instance)

    def commit(self):
        if self.commit_error:
            raise self.commit_error

    def rollback(self):
        self.rollbacks += 1


def test_delete_with_files_restores_data_when_commit_fails(tmp_path):
    path = tmp_path / "take.wav"
    path.write_bytes(b"audio")
    instance = object()
    db = FakeDb(RuntimeError("locked"))

    with pytest.raises(RuntimeError, match="locked"):
        resource_deletion.delete_with_files(db, instance, (path,))

    assert path.read_bytes() == b"audio"
    assert db.deleted == [instance]
    assert db.rollbacks == 1


def test_delete_with_files_does_not_fail_after_successful_commit_when_purge_fails(
    tmp_path, monkeypatch
):
    path = tmp_path / "take.wav"
    path.write_bytes(b"audio")
    db = FakeDb()
    monkeypatch.setattr(
        resource_deletion,
        "purge_quarantined_paths",
        lambda _paths: (_ for _ in ()).throw(PermissionError("busy")),
    )

    resource_deletion.delete_with_files(db, object(), (path,))

    assert not path.exists()
    assert db.rollbacks == 0


def test_parse_json_value_returns_default_for_corrupt_data():
    assert parse_json_value("{broken", None) is None
    assert parse_json_value(None, []) == []


def test_analysis_output_survives_corrupt_sections_json():
    result = SimpleNamespace(
        id="analysis",
        recording_id="recording",
        pitch_accuracy_percent=91.0,
        mean_deviation_semitones=0.1,
        sections_json="{broken",
        created_at=datetime.now(UTC),
    )

    output = analysis_router._to_out(result)

    assert output.sections is None
    assert analysis_router.get_sections(result) == {"sections": None}
