from app.services import pipeline_service


def test_releasing_an_old_worker_does_not_remove_the_new_job(monkeypatch):
    song_id = "song-id"
    old_worker = object()
    new_worker = object()
    monkeypatch.setattr(pipeline_service.threading, "current_thread", lambda: old_worker)
    monkeypatch.setattr(pipeline_service, "_active_jobs", {song_id: new_worker})

    pipeline_service._release_active_job(song_id)

    assert pipeline_service._active_jobs[song_id] is new_worker


def test_releasing_the_own_worker_removes_the_job(monkeypatch):
    song_id = "song-id"
    worker = object()
    monkeypatch.setattr(pipeline_service.threading, "current_thread", lambda: worker)
    monkeypatch.setattr(pipeline_service, "_active_jobs", {song_id: worker})

    pipeline_service._release_active_job(song_id)

    assert song_id not in pipeline_service._active_jobs
