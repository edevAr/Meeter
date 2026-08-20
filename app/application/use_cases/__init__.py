"""Use-case facades kept for a stable application-layer API.

Services already encode the primary use cases; these wrappers exist so
future Zoom/Teams/calendar adapters can call a single entry point.
"""

from __future__ import annotations

from app.application.services.analysis_service import AIAnalysisService
from app.application.services.recording_service import RecordingService
from app.application.services.transcription_service import TranscriptionService
from app.domain.models.analysis import MeetingAnalysis
from app.domain.models.enums import AudioSourceType
from app.domain.models.recording import Recording
from app.domain.models.transcript import Transcript
from app.infrastructure.audio.recorder import RecordingResult


class SaveRecordingUseCase:
    def __init__(self, recordings: RecordingService) -> None:
        self._recordings = recordings

    def execute(
        self,
        result: RecordingResult,
        title: str,
        source: AudioSourceType,
        device_name: str | None = None,
    ) -> Recording:
        return self._recordings.create_from_capture(result, title, source, device_name)


class TranscribeRecordingUseCase:
    def __init__(self, transcriptions: TranscriptionService) -> None:
        self._transcriptions = transcriptions

    async def execute(self, recording_id: str, language: str | None = None) -> Transcript:
        return await self._transcriptions.transcribe(recording_id, language=language)


class AnalyzeRecordingUseCase:
    def __init__(self, analysis: AIAnalysisService) -> None:
        self._analysis = analysis

    async def execute(self, recording_id: str) -> MeetingAnalysis:
        return await self._analysis.analyze(recording_id)
