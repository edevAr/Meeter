from __future__ import annotations

from pathlib import Path

import pytest
from app.config.settings import Settings
from app.domain.interfaces.ai import AIProvider
from app.domain.interfaces.diarization import SpeakerDiarizationProvider, SpeakerTurn
from app.domain.interfaces.transcription import TranscriptResult, TranscriptSegmentResult, TranscriptionProvider
from app.domain.models.analysis import LLMActionItem, MeetingAnalysisResult
from app.domain.models.enums import ActionItemPriority
from app.infrastructure.database.repositories import SqlAlchemyUnitOfWork
from app.infrastructure.database.session import init_database, make_session_factory
from sqlalchemy import create_engine


class FakeTranscriptionProvider(TranscriptionProvider):
    name = "fake-whisper"
    is_cloud = False

    def __init__(self, text: str = "Hello everyone. We should migrate the database this weekend.") -> None:
        self.text = text
        self.calls: list[str] = []

    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
        progress_callback: callable | None = None,
    ) -> TranscriptResult:
        self.calls.append(audio_path)
        if progress_callback:
            progress_callback(50)
            progress_callback(100)
        return TranscriptResult(
            text=self.text,
            language=language or "en",
            segments=[
                TranscriptSegmentResult(0.0, 2.5, "Hello everyone.", speaker=None),
                TranscriptSegmentResult(2.5, 6.0, "We should migrate the database this weekend.", speaker=None),
            ],
            provider=self.name,
            model_name="fake",
        )


class FakeAIProvider(AIProvider):
    name = "fake-llm"
    is_cloud = False
    model = "fake-model"

    def __init__(self) -> None:
        self.calls: list[str] = []

    async def analyze(self, transcript: str, title: str | None = None) -> MeetingAnalysisResult:
        self.calls.append(transcript)
        return MeetingAnalysisResult(
            summary="The team discussed a weekend database migration.",
            key_topics=["Database migration", "Weekend deployment"],
            decisions=["The team decided to migrate the database during the weekend."],
            action_items=[
                LLMActionItem(
                    task="Prepare migration script",
                    owner="John",
                    due_date="Aug 20",
                    priority=ActionItemPriority.HIGH,
                )
            ],
            participants=["John"],
        )


class FakeDiarization(SpeakerDiarizationProvider):
    name = "none"

    async def identify_speakers(self, audio_path: str) -> list[SpeakerTurn]:
        return []


class SpeakerFakeDiarization(SpeakerDiarizationProvider):
    name = "fake-diarization"

    async def identify_speakers(self, audio_path: str) -> list[SpeakerTurn]:
        del audio_path
        return [
            SpeakerTurn(0.0, 2.5, "A"),
            SpeakerTurn(2.5, 6.0, "B"),
        ]


@pytest.fixture
def settings(tmp_path: Path) -> Settings:
    recordings = tmp_path / "recordings"
    transcripts = tmp_path / "transcripts"
    exports = tmp_path / "exports"
    recordings.mkdir()
    transcripts.mkdir()
    exports.mkdir()
    return Settings(
        database_url=f"sqlite:///{tmp_path / 'app.db'}",
        recordings_path=recordings,
        transcripts_path=transcripts,
        exports_path=exports,
        ai_api_key="",
        transcription_provider="whisper",
        allow_cloud_transcription=False,
    )


@pytest.fixture
def uow_factory(settings: Settings):
    engine = create_engine(settings.database_url, connect_args={"check_same_thread": False}, future=True)
    init_database(engine)
    factory = make_session_factory(engine)
    return lambda: SqlAlchemyUnitOfWork(factory)
