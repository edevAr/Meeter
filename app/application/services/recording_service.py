from __future__ import annotations

import logging
from datetime import datetime, timezone
from pathlib import Path
from uuid import uuid4

from app.config.settings import Settings
from app.domain.models.enums import AudioSourceType, RecordingStatus
from app.domain.models.recording import Recording
from app.infrastructure.audio.recorder import AudioRecorder, RecordingResult
from app.infrastructure.audio.sources import MicrophoneSource, SystemAudioSource
from app.infrastructure.security.files import (
    ALLOWED_AUDIO_EXTENSIONS,
    FileValidationError,
    delete_file_quietly,
    safe_join,
    sanitize_filename,
)

logger = logging.getLogger(__name__)


def format_duration(seconds: float) -> str:
    total = int(max(0, seconds))
    hours, remainder = divmod(total, 3600)
    minutes, secs = divmod(remainder, 60)
    if hours:
        return f"{hours:d} hr {minutes:d} min"
    if minutes:
        return f"{minutes:d} min"
    return f"{secs:d} sec"


class RecordingService:
    def __init__(self, uow_factory, settings: Settings) -> None:
        self._uow_factory = uow_factory
        self._settings = settings

    def list_recordings(self) -> list[Recording]:
        with self._uow_factory() as uow:
            return uow.recordings.list()

    def get(self, recording_id: str) -> Recording | None:
        with self._uow_factory() as uow:
            return uow.recordings.get(recording_id)

    def counts(self) -> dict[str, int]:
        with self._uow_factory() as uow:
            return uow.recordings.counts()

    def create_from_capture(
        self,
        result: RecordingResult,
        title: str,
        source: AudioSourceType,
        device_name: str | None = None,
    ) -> Recording:
        recording = Recording(
            title=title.strip() or "Untitled recording",
            file_path=str(result.path),
            duration_seconds=result.duration_seconds,
            status=RecordingStatus.RECORDED,
            source=source,
            sample_rate=self._settings.audio_sample_rate,
            channels=self._settings.audio_channels,
            sample_width=self._settings.audio_sample_width,
            file_size_bytes=result.bytes_written,
            device_name=device_name,
        )
        with self._uow_factory() as uow:
            uow.recordings.add(recording)
            uow.commit()
        logger.info("Recording saved")
        return recording

    def save_upload(
        self,
        *,
        original_name: str,
        data: bytes,
        title: str,
        duration_seconds: float,
        source: AudioSourceType = AudioSourceType.MICROPHONE,
        device_name: str | None = "mobile",
    ) -> Recording:
        suffix = Path(original_name).suffix.lower() or ".m4a"
        if suffix not in ALLOWED_AUDIO_EXTENSIONS:
            raise FileValidationError(f"Unsupported audio extension: {suffix}")
        if not data:
            raise FileValidationError("Audio file is empty")
        if len(data) > self._settings.max_recording_bytes:
            raise FileValidationError("Audio file exceeds maximum allowed size")
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        filename = f"{stamp}-{sanitize_filename(title)}-{uuid4().hex[:8]}{suffix}"
        path = safe_join(self._settings.recordings_path, filename)
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        return self.create_from_capture(
            RecordingResult(path=path, duration_seconds=duration_seconds, bytes_written=len(data)),
            title,
            source,
            device_name=device_name,
        )

    def create_placeholder(self, title: str, source: AudioSourceType) -> tuple[Recording, Path]:
        stamp = datetime.now(timezone.utc).strftime("%Y%m%d-%H%M%S")
        filename = f"{stamp}-{sanitize_filename(title)}-{uuid4().hex[:8]}.wav"
        path = safe_join(self._settings.recordings_path, filename)
        recording = Recording(
            title=title.strip() or "Untitled recording",
            file_path=str(path),
            status=RecordingStatus.RECORDING,
            source=source,
            sample_rate=self._settings.audio_sample_rate,
            channels=self._settings.audio_channels,
            sample_width=self._settings.audio_sample_width,
        )
        with self._uow_factory() as uow:
            uow.recordings.add(recording)
            uow.commit()
        return recording, path

    def mark_status(
        self,
        recording_id: str,
        status: RecordingStatus,
        error_message: str | None = None,
        duration_seconds: float | None = None,
        file_size_bytes: int | None = None,
    ) -> Recording:
        with self._uow_factory() as uow:
            recording = uow.recordings.get(recording_id)
            if recording is None:
                raise KeyError(recording_id)
            recording.status = status
            recording.error_message = error_message
            recording.touch()
            if duration_seconds is not None:
                recording.duration_seconds = duration_seconds
            if file_size_bytes is not None:
                recording.file_size_bytes = file_size_bytes
            uow.recordings.update(recording)
            uow.commit()
            return recording

    def reopen_stuck_transcriptions(self) -> int:
        """A killed worker leaves recordings in TRANSCRIBING. Make them retryable."""
        count = 0
        with self._uow_factory() as uow:
            for recording in uow.recordings.list():
                if recording.status != RecordingStatus.TRANSCRIBING:
                    continue
                recording.status = RecordingStatus.RECORDED
                recording.error_message = None
                recording.touch()
                uow.recordings.update(recording)
                count += 1
            if count:
                uow.commit()
        if count:
            logger.info("Reopened stuck transcriptions count=%s", count)
        return count

    def rename(self, recording_id: str, title: str) -> Recording:
        with self._uow_factory() as uow:
            recording = uow.recordings.get(recording_id)
            if recording is None:
                raise KeyError(recording_id)
            recording.title = title.strip() or recording.title
            recording.touch()
            uow.recordings.update(recording)
            uow.commit()
            return recording

    def delete(self, recording_id: str) -> None:
        with self._uow_factory() as uow:
            recording = uow.recordings.get(recording_id)
            if recording is None:
                raise KeyError(recording_id)
            file_path = recording.file_path
            uow.action_items.delete_by_recording(recording_id)
            uow.analyses.delete_by_recording(recording_id)
            uow.transcripts.delete_by_recording(recording_id)
            uow.recordings.delete(recording_id)
            uow.commit()
        delete_file_quietly(file_path)
        logger.info("Recording deleted")

    def new_recorder(self) -> AudioRecorder:
        return AudioRecorder(
            sample_rate=self._settings.audio_sample_rate,
            channels=self._settings.audio_channels,
            sample_width=self._settings.audio_sample_width,
            max_bytes=self._settings.max_recording_bytes,
        )

    def source_for(self, source: AudioSourceType, device_id: str | None) -> MicrophoneSource:
        if source == AudioSourceType.SYSTEM:
            return SystemAudioSource(
                device_id=device_id,
                sample_rate=self._settings.audio_sample_rate,
                channels=self._settings.audio_channels,
            )
        return MicrophoneSource(
            device_id=device_id,
            sample_rate=self._settings.audio_sample_rate,
            channels=self._settings.audio_channels,
        )
