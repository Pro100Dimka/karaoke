from unittest.mock import Mock

from app.routers import diagnostics


def test_shutdown_cancels_active_processing_and_reports_the_count(monkeypatch):
    monkeypatch.setattr(diagnostics.pipeline_service, "cancel_all_active_processing", Mock(return_value=2))
    assert diagnostics.shutdown() == {"cancelled": 2}
