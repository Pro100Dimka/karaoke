"""
Точка запуска backend'а.

Запускать из корня backend/:

    python run.py

Хост/порт настраиваются через config.py (переменные окружения
SONGAPP_HOST / SONGAPP_PORT — см. config.py).
"""

import logging
import sys
from logging.handlers import RotatingFileHandler

import uvicorn


def configure_logging() -> None:
    import config

    log_path = config.APP_LOG_DIR / "backend.log"
    handler = RotatingFileHandler(log_path, maxBytes=2_000_000, backupCount=3, encoding="utf-8")
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(levelname)s %(name)s: %(message)s",
        handlers=[handler, logging.StreamHandler(sys.stdout)],
        force=True,
    )


def main() -> None:
    if "--install-ai-models" in sys.argv:
        from AI.install_models import main as install_models

        args = [arg for arg in sys.argv[1:] if arg != "--install-ai-models"]
        raise SystemExit(install_models(args))

    if "--verify-ai-runtime" in sys.argv:
        from pathlib import Path

        import torchfcpe

        checkpoint = Path(torchfcpe.__file__).resolve().parent / "assets" / "fcpe_c_v001.pt"
        if not checkpoint.is_file():
            raise FileNotFoundError(f"Bundled TorchFCPE checkpoint is missing: {checkpoint}")
        model = torchfcpe.spawn_bundled_infer_model(device="cpu")
        print(f"TorchFCPE runtime ready: {type(model).__name__} ({checkpoint})")
        return

    import config
    from app.main import app

    configure_logging()
    uvicorn.run(app, host=config.HOST, port=config.PORT)


if __name__ == "__main__":
    import multiprocessing

    multiprocessing.freeze_support()
    main()
