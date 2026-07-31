"""
Точка запуска backend'а.

Запускать из корня backend/:

    python run.py

Хост/порт настраиваются через config.py (переменные окружения
SONGAPP_HOST / SONGAPP_PORT — см. config.py).
"""
import uvicorn

import config
from app.main import app


def main() -> None:
    uvicorn.run(app, host=config.HOST, port=config.PORT)


if __name__ == "__main__":
    main()
