"""
Точка входа FastAPI-приложения.

Это чистый backend/API — без UI. Локальный React/Electron/Qt-фронтенд
(добавится позже) будет стучаться сюда по http://127.0.0.1:8000.
"""
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.routers import analysis, application, audio, cache, diagnostics, player, recording, songs
from database import init_db


@asynccontextmanager
async def lifespan(_app: FastAPI):
    init_db()
    yield


app = FastAPI(
    title="Karaoke AI Backend",
    description="Локальный backend поверх AI-пайплайна: управление песнями, плеер, запись, анализ голоса.",
    version="0.1.0",
    lifespan=lifespan,
)

# Локальная десктоп-программа: UI открывается как отдельное окно/процесс
# (Electron/Tauri/браузер) на localhost. allow_credentials=True вместе с
# allow_origins=["*"] запрещён спецификацией CORS и браузеры такой ответ
# всё равно отклонят — поэтому здесь явный список localhost-портов, а не
# wildcard. При появлении конкретного UI-порта оставь только его.
_LOCAL_UI_ORIGINS = [
    "http://127.0.0.1:3000",
    "http://localhost:3000",
    "http://127.0.0.1:5173",
    "http://localhost:5173",
]

app.add_middleware(
    CORSMiddleware,
    allow_origins=_LOCAL_UI_ORIGINS,
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
app.include_router(application.router)


@app.get("/")
def root():
    return {"name": "Karaoke AI Backend", "docs": "/docs"}
