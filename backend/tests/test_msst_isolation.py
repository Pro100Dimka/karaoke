from __future__ import annotations

import sys

import models as backend_models
from AI.engines.separation import _run_msst_worker


class _ResultQueue:
    def __init__(self) -> None:
        self.values: list[str | None] = []

    def put(self, value: str | None) -> None:
        self.values.append(value)


def test_msst_worker_uses_its_model_namespace_and_restores_backend(tmp_path):
    engine = tmp_path / "msst"
    model_dir = engine / "models"
    model_dir.mkdir(parents=True)
    (model_dir / "bs_roformer.py").write_text("ORIGIN = 'msst'\n", encoding="utf-8")
    (engine / "inference.py").write_text(
        "from models.bs_roformer import ORIGIN\n"
        "def proc_folder(arguments):\n"
        "    assert ORIGIN == 'msst'\n"
        "    assert arguments['marker'] == 'worker'\n",
        encoding="utf-8",
    )
    queue = _ResultQueue()

    _run_msst_worker(str(engine), {"marker": "worker"}, queue)

    assert queue.values == [None]
    assert sys.modules["models"] is backend_models
    assert "models.bs_roformer" not in sys.modules
