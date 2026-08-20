from __future__ import annotations

import logging
from pathlib import Path
from uuid import uuid4

from app.domain.interfaces.diarization import SpeakerDiarizationProvider
from app.domain.interfaces.transcription import TranscriptionProvider
from app.domain.models.enums import RecordingStatus
from app.domain.models.transcript import Transcript, TranscriptSegment
from app.infrastructure.security.files import validate_audio_path
from app.infrastructure.transcription.whisper_provider import TranscriptionError

logger = logging.getLogger(__name__)


class TranscriptionService:
    def __init__(
        self,
        uow_factory,
        provider: TranscriptionProvider,
        diarization: SpeakerDiarizationProvider,
        max_bytes: int,
    ) -> None:
        self._uow_factory = uow_factory
        self._provider = provider
        self._diarization = diarization
        self._max_bytes = max_bytes

    @property
    def provider(self) -> TranscriptionProvider:
        return self._provider

    async def transcribe(
        self,
        recording_id: str,
        language: str | None = None,
        progress_callback: callable | None = None,
    ) -> Transcript:
        with self._uow_factory() as uow:
            recording = uow.recordings.get(recording_id)
            if recording is None:
                raise KeyError(recording_id)
            if not recording.status.can_transcribe:
                raise TranscriptionError("Recording is not ready to transcribe")
            path = recording.file_path
            recording.status = RecordingStatus.TRANSCRIBING
            recording.error_message = None
            recording.touch()
            uow.recordings.update(recording)
            uow.commit()

        validate_audio_path(Path(path), self._max_bytes, must_exist=True)

        try:
            result = await self._provider.transcribe(
                path,
                language=language,
                progress_callback=progress_callback,
            )
            speaker_turns = await self._diarization.identify_speakers(path)
        except Exception as exc:
            with self._uow_factory() as uow:
                recording = uow.recordings.get(recording_id)
                if recording is not None:
                    recording.status = RecordingStatus.FAILED
                    recording.error_message = "Transcription failed"
                    recording.touch()
                    uow.recordings.update(recording)
                    uow.commit()
            if isinstance(exc, TranscriptionError):
                raise
            raise TranscriptionError("Transcription failed") from exc

        speaker_by_time = speaker_turns
        transcript_id = str(uuid4())
        segments: list[TranscriptSegment] = []
        for index, seg in enumerate(result.segments):
            speaker = seg.speaker
            if speaker is None:
                speaker = _speaker_at(speaker_by_time, seg.start_time)
            segments.append(
                TranscriptSegment(
                    transcript_id=transcript_id,
                    start_time=seg.start_time,
                    end_time=seg.end_time,
                    speaker=speaker,
                    text=seg.text,
                    sequence=index,
                )
            )
        transcript = Transcript(
            id=transcript_id,
            recording_id=recording_id,
            text=result.text,
            language=result.language or language,
            provider=result.provider,
            model_name=result.model_name,
            segments=segments,
        )
        with self._uow_factory() as uow:
            uow.transcripts.add(transcript)
            recording = uow.recordings.get(recording_id)
            if recording is not None:
                recording.status = RecordingStatus.TRANSCRIBED
                recording.language = transcript.language
                recording.error_message = None
                recording.touch()
                uow.recordings.update(recording)
            uow.commit()
        logger.info("Transcription saved")
        return transcript

    def get_for_recording(self, recording_id: str) -> Transcript | None:
        with self._uow_factory() as uow:
            return uow.transcripts.get_by_recording(recording_id)


def _speaker_at(turns, start: float) -> str | None:
    for turn in turns:
        if turn.start_time <= start <= turn.end_time:
            return turn.speaker
    return None
