from __future__ import annotations

import logging
from uuid import uuid4

from app.domain.interfaces.ai import AIProvider
from app.domain.models.action_item import ActionItem
from app.domain.models.analysis import Decision, KeyTopic, MeetingAnalysis
from app.domain.models.enums import RecordingStatus
from app.infrastructure.ai.llm_provider import AIProviderError
from app.infrastructure.transcription.alignment import format_speaker_transcript

logger = logging.getLogger(__name__)


class AIAnalysisService:
    def __init__(self, uow_factory, provider: AIProvider) -> None:
        self._uow_factory = uow_factory
        self._provider = provider

    @property
    def provider(self) -> AIProvider:
        return self._provider

    async def analyze(self, recording_id: str) -> MeetingAnalysis:
        with self._uow_factory() as uow:
            recording = uow.recordings.get(recording_id)
            transcript = uow.transcripts.get_by_recording(recording_id)
            if recording is None:
                raise KeyError(recording_id)
            if transcript is None:
                raise AIProviderError("Transcribe the recording before running AI analysis")
            if not recording.status.can_analyze and recording.status != RecordingStatus.FAILED:
                raise AIProviderError("Recording is not ready for AI analysis")
            title = recording.title
            text = format_speaker_transcript(transcript.segments, fallback=transcript.text)
            speakers = sorted({seg.speaker for seg in transcript.segments if seg.speaker})
            transcript_id = transcript.id
            recording.status = RecordingStatus.ANALYZING
            recording.error_message = None
            recording.touch()
            uow.recordings.update(recording)
            uow.commit()

        try:
            result = await self._provider.analyze(text, title=title)
            if not result.participants and speakers:
                result.participants = speakers
        except Exception as exc:
            with self._uow_factory() as uow:
                recording = uow.recordings.get(recording_id)
                if recording is not None:
                    recording.status = RecordingStatus.TRANSCRIBED
                    recording.error_message = str(exc) if isinstance(exc, AIProviderError) else "AI analysis failed"
                    recording.touch()
                    uow.recordings.update(recording)
                    uow.commit()
            if isinstance(exc, AIProviderError):
                raise
            raise AIProviderError("AI analysis failed") from exc

        analysis_id = str(uuid4())
        analysis = MeetingAnalysis(
            id=analysis_id,
            recording_id=recording_id,
            transcript_id=transcript_id,
            summary=result.summary,
            provider=self._provider.name,
            model_name=getattr(self._provider, "model", None),
            participants=result.participants,
            key_topics=[
                KeyTopic(analysis_id=analysis_id, topic=topic, sequence=index)
                for index, topic in enumerate(result.key_topics)
            ],
            decisions=[
                Decision(analysis_id=analysis_id, text=decision, sequence=index)
                for index, decision in enumerate(result.decisions)
            ],
        )
        items = [
            ActionItem(
                analysis_id=analysis_id,
                recording_id=recording_id,
                recording_title=title,
                task=item.task,
                owner=item.owner,
                due_date=item.due_date,
                priority=item.priority,
                status=item.status,
            )
            for item in result.action_items
            if item.task.strip()
        ]
        with self._uow_factory() as uow:
            uow.action_items.delete_by_recording(recording_id)
            uow.analyses.add(analysis)
            if items:
                uow.action_items.add_many(items)
            recording = uow.recordings.get(recording_id)
            if recording is not None:
                recording.status = RecordingStatus.ANALYZED
                recording.error_message = None
                recording.touch()
                uow.recordings.update(recording)
            uow.commit()
        logger.info("AI analysis saved")
        return analysis

    def get_for_recording(self, recording_id: str) -> MeetingAnalysis | None:
        with self._uow_factory() as uow:
            return uow.analyses.get_by_recording(recording_id)
