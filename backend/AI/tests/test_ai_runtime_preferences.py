import os

from app.services import app_settings_service, pipeline_service


def test_ai_runtime_preferences_force_cpu_and_thread_count(monkeypatch):
    monkeypatch.setattr(
        app_settings_service,
        "read_settings",
        lambda: {"use_gpu": False, "use_cpu": True, "thread_count": 3},
    )

    device = pipeline_service._configure_ai_runtime()

    assert device == "cpu"
    assert os.environ["SONGAPP_DEVICE"] == "cpu"
    assert os.environ["OMP_NUM_THREADS"] == "3"
