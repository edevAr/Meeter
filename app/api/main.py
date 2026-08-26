from __future__ import annotations

import asyncio
import logging
from contextlib import asynccontextmanager

import uvicorn
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.deps import get_container, set_container
from app.api.routes.action_items import router as action_items_router
from app.api.routes.agenda import router as agenda_router
from app.api.routes.auth import router as auth_router
from app.api.routes.live import router as live_router
from app.api.routes.notes import router as notes_router
from app.api.routes.recordings import router as recordings_router
from app.api.routes.tasks import router as tasks_router
from app.api.routes.workspace import router as workspace_router
from app.config.settings import get_settings
from app.container import AppContainer
from app.infrastructure.logging.setup import setup_logging

logger = logging.getLogger(__name__)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    container = get_container()
    container.note_events.bind(asyncio.get_running_loop())
    container.recordings.reopen_stuck_transcriptions()
    warmup = getattr(container.transcription, "warmup", None)
    if callable(warmup):
        logger.info("Whisper warmup started")
        await asyncio.to_thread(warmup)
        logger.info("Whisper warmup completed")
    yield


def create_app(container: AppContainer | None = None) -> FastAPI:
    settings = get_settings()
    setup_logging(settings.log_level)
    if container is not None:
        set_container(container)
    else:
        get_container()

    app = FastAPI(
        title="AI Call Recorder API",
        version="1.0.0",
        description="Backend for the AI Call Recorder mobile app and Meeter web agenda.",
        lifespan=lifespan,
    )
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["*"],
        allow_methods=["*"],
        allow_headers=["*"],
    )
    app.include_router(auth_router)
    app.include_router(recordings_router)
    app.include_router(action_items_router)
    app.include_router(notes_router)
    app.include_router(tasks_router)
    app.include_router(agenda_router)
    app.include_router(live_router)
    app.include_router(workspace_router)

    @app.get("/api/health")
    def health() -> dict[str, str]:
        return {"status": "ok"}

    return app


def run() -> None:
    settings = get_settings()
    uvicorn.run(
        "app.api.main:create_app",
        factory=True,
        host=settings.host,
        port=settings.port,
        reload=False,
    )
