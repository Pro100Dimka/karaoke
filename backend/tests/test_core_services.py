from tests._shared import patch_attrs, make_song, raises

from datetime import UTC, datetime
from unittest.mock import Mock

import pytest
from sqlalchemy import create_engine
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

import models
from app import repositories
from app.services import db_utils, player_service, resource_deletion
from app.utils.json_files import write_json
from database import Base


@pytest.fixture
def database():
    engine = create_engine("sqlite://"); Base.metadata.create_all(engine)
    with Session(engine) as session: yield session
    engine.dispose()


def song(song_id: str='song', *, output_dir: str | None=None) -> models.Song: return make_song(id=song_id, source_path='C:/song.wav', slug=song_id, output_dir=output_dir)


def test_commit_helpers_rollback_failures_and_refresh_instances(): database, instance = Mock(), object(); assert db_utils.commit_refresh(database, instance) is instance; database.commit.assert_called_once_with(); database.refresh.assert_called_once_with(instance); database.reset_mock(); database.commit.side_effect = RuntimeError("database unavailable"); raises(RuntimeError, lambda: db_utils.commit(database), match='unavailable'); database.rollback.assert_called_once_with()


def test_transactional_resource_deletion_purges_after_commit(tmp_path): path = tmp_path / "audio.wav"; path.write_bytes(b"audio"); database, instance = Mock(), object(); resource_deletion.delete_with_files(database, instance, [path]); database.delete.assert_called_once_with(instance); database.commit.assert_called_once_with(); assert not path.exists()


def test_transactional_resource_deletion_restores_after_commit_failure(tmp_path): path = tmp_path / "audio.wav"; path.write_bytes(b"audio"); database = Mock(); database.commit.side_effect = RuntimeError("commit failed"); raises(RuntimeError, lambda: resource_deletion.delete_with_files(database, object(), [path]), match='commit failed'); database.rollback.assert_called_once_with(); assert path.read_bytes() == b"audio"


def test_transactional_resource_deletion_tolerates_cleanup_failure(monkeypatch, caplog): database = Mock(); patch_attrs(monkeypatch, resource_deletion, quarantine_paths=lambda _paths: {}, purge_quarantined_paths=Mock(side_effect=OSError('locked'))); resource_deletion.delete_with_files(database, object(), []); assert "could not be purged" in caplog.text


def test_transactional_resource_deletion_preserves_restore_error_note(monkeypatch):
    database, failure = Mock(), RuntimeError('commit failed'); database.commit.side_effect = failure; patch_attrs(monkeypatch, resource_deletion, quarantine_paths=lambda _paths: {}, restore_quarantined_paths=Mock(side_effect=OSError('restore failed')))

    with pytest.raises(RuntimeError) as error: resource_deletion.delete_with_files(database, object(), [])

    assert error.value.__notes__ == ["Could not restore quarantined files: restore failed"]


def test_repositories_query_complete_library(database): first_song, second_song, old, recent, other, analysis, state = song('first'), song('second'), models.Recording(id='old', song_id='first', filename='old.wav', path='C:/old.wav', created_at=datetime(2026, 1, 1, tzinfo=UTC)), models.Recording(id='recent', song_id='first', filename='recent.wav', path='C:/recent.wav', created_at=datetime(2026, 1, 2, tzinfo=UTC)), models.Recording(id='other', song_id='second', filename='other.wav', path='C:/other.wav', created_at=datetime(2026, 1, 3, tzinfo=UTC)), models.AnalysisResult(id='analysis', recording_id='recent'), models.PlaybackState(song_id='first'); database.add_all([first_song, second_song, old, recent, other, analysis, state]); database.commit(); assert (repositories.get_song(database, 'first') is first_song) and (repositories.get_recording(database, 'recent') is recent) and (repositories.get_analysis_by_recording(database, 'recent') is analysis) and (repositories.get_playback_state(database, 'first') is state) and ([item.id for item in repositories.list_recordings_for_song(database, 'first')] == ['recent', 'old']) and ([(item.id, title) for item, title in repositories.list_recording_library(database)] == [('other', 'Song'), ('recent', 'Song'), ('old', 'Song')])


def test_player_data_and_state_lifecycle(monkeypatch, tmp_path, database):
    current_song = song(output_dir=str(tmp_path)); database.add(current_song); database.commit(); monkeypatch.setattr(player_service.song_service, "resolve_output_dir", lambda _song: tmp_path)
    payloads = {
        "lyrics.json": {"words": ["hello"]},
        "structure.json": {"sections": []},
        "music.json": {"tempo": 120},
        "breaths.json": {"events": []},
        "songInfo.json": {"title": "Song"},
    }
    for filename, payload in payloads.items(): write_json(tmp_path / filename, payload)

    assert (player_service.get_sync_data(song()) == {}) and (player_service.get_timeline(song()) == {}) and (player_service.get_sync_data(current_song) == {'lyrics': payloads['lyrics.json'], 'structure': payloads['structure.json'], 'music': payloads['music.json'], 'breaths': payloads['breaths.json']}) and (player_service.get_timeline(current_song) == {'structure': payloads['structure.json'], 'song_info': payloads['songInfo.json']}) and (player_service.get_state(database, 'song').position_sec == 0) and (player_service.seek(database, 'song', -4).position_sec == 0) and (player_service.seek(database, 'song', 2.5).position_sec == 2.5) and (player_service.set_playing(database, 'song', True).is_playing is True); stopped = player_service.stop(database, "song"); assert stopped.is_playing is False and stopped.position_sec == 0


def test_player_state_recovers_from_concurrent_insert(monkeypatch): database, winner = Mock(), models.PlaybackState(song_id='song', position_sec=1); patch_attrs(monkeypatch, player_service.repositories, get_playback_state=Mock(side_effect=[None, winner])); patch_attrs(monkeypatch, player_service, commit_refresh=Mock(side_effect=IntegrityError('insert', {}, Exception('duplicate')))); assert player_service.get_state(database, "song") is winner; database.rollback.assert_called_once_with()


def test_player_state_reraises_concurrent_insert_without_winner(monkeypatch): database = Mock(); monkeypatch.setattr(player_service.repositories, "get_playback_state", Mock(return_value=None)); patch_attrs(monkeypatch, player_service, commit_refresh=Mock(side_effect=IntegrityError('insert', {}, Exception('duplicate')))); raises(IntegrityError, lambda: player_service.get_state(database, 'song'))
