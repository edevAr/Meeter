from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.application.services.action_item_service import ActionItemService
from app.application.services.agenda_service import AgendaService
from app.application.services.analysis_service import AIAnalysisService
from app.application.services.dashboard_service import DashboardService
from app.application.services.export_service import ExportService
from app.application.services.note_service import NoteService
from app.application.services.recording_service import RecordingService
from app.application.services.search_service import SearchService
from app.application.services.task_service import TaskService
from app.application.services.transcription_service import TranscriptionService
from app.config.settings import Settings, get_settings
from app.domain.interfaces.ai import AIProvider
from app.domain.interfaces.transcription import TranscriptionProvider
from app.infrastructure.ai.diarization import NullSpeakerDiarizationProvider
from app.infrastructure.ai.factory import create_ai_provider
from app.infrastructure.database.repositories import SqlAlchemyUnitOfWork
from app.infrastructure.database.session import (
    create_engine_from_settings,
    init_database,
    make_session_factory,
)
from app.infrastructure.transcription.factory import create_transcription_provider


@dataclass
class AppContainer:
    settings: Settings
    engine: Engine
    session_factory: sessionmaker[Session]
    transcription: TranscriptionProvider
    ai: AIProvider
    recordings: RecordingService
    transcriptions: TranscriptionService
    analysis: AIAnalysisService
    action_items: ActionItemService
    notes: NoteService
    tasks: TaskService
    agenda: AgendaService
    exports: ExportService
    search: SearchService
    dashboard: DashboardService
    uow_factory: Callable[[], SqlAlchemyUnitOfWork]


def build_container(settings: Settings | None = None) -> AppContainer:
    settings = settings or get_settings()
    settings.ensure_directories()
    engine = create_engine_from_settings(settings)
    init_database(engine)
    session_factory = make_session_factory(engine)

    def uow_factory() -> SqlAlchemyUnitOfWork:
        return SqlAlchemyUnitOfWork(session_factory)

    transcription = create_transcription_provider(settings)
    ai = create_ai_provider(settings)
    recordings = RecordingService(uow_factory, settings)
    transcriptions = TranscriptionService(
        uow_factory,
        transcription,
        NullSpeakerDiarizationProvider(),
        settings.max_recording_bytes,
    )
    analysis = AIAnalysisService(uow_factory, ai)
    action_items = ActionItemService(uow_factory)
    notes = NoteService(uow_factory)
    tasks = TaskService(uow_factory)
    agenda = AgendaService(uow_factory)
    exports = ExportService(settings)
    search = SearchService(uow_factory)
    dashboard = DashboardService(uow_factory)
    return AppContainer(
        settings=settings,
        engine=engine,
        session_factory=session_factory,
        transcription=transcription,
        ai=ai,
        recordings=recordings,
        transcriptions=transcriptions,
        analysis=analysis,
        action_items=action_items,
        notes=notes,
        tasks=tasks,
        agenda=agenda,
        exports=exports,
        search=search,
        dashboard=dashboard,
        uow_factory=uow_factory,
    )
