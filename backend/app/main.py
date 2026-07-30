"""
Точка входа FastAPI-приложения.

Это чистый backend/API — без UI. Локальный React/Electron/Qt-фронтенд
(добавится позже) будет стучаться сюда по http://127.0.0.1:8000.
"""
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from database import init_db
from app.routers import songs, player, recording, analysis, cache, diagnostics, audio

app = FastAPI(
    title="Karaoke AI Backend",
    description="Локальный backend поверх AI-пайплайна: управление песнями, плеер, запись, анализ голоса.",
    version="0.1.0",
)

# Локальная десктоп-программа: UI будет открываться как отдельное окно/
# процесс (Electron/Tauri/браузер) и стучаться на localhost — разрешаем
# запросы с любого локального origin. При появлении конкретного UI-порта
# стоит сузить allow_origins до него.
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(songs.router)
app.include_router(player.router)
app.include_router(recording.router)
app.include_router(analysis.router)
app.include_router(cache.router)
app.include_router(diagnostics.router)
app.include_router(audio.router)


@app.on_event("startup")
def on_startup() -> None:
    init_db()


@app.get("/")
def root():
    return {"name": "Karaoke AI Backend", "docs": "/docs"}
