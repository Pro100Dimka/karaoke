from pathlib import Path

from fastapi.testclient import TestClient

from app.main import app
from app.services import diagnostics_service
from app.version import APP_VERSION


def test_openapi_and_diagnostics_use_the_canonical_product_version():
    canonical = (Path(__file__).resolve().parents[2] / "VERSION").read_text(encoding="utf-8").strip()
    assert APP_VERSION == canonical == diagnostics_service.BACKEND_VERSION
    assert app.version == canonical
    assert TestClient(app).get("/openapi.json").json()["info"]["version"] == canonical
    assert diagnostics_service.versions()["backend_version"] == canonical
    assert diagnostics_service.versions()["build_id"] == diagnostics_service.BUILD_ID
    assert diagnostics_service.BUILD_ID != "unknown"
