from __future__ import annotations

import pytest

from app.application.services.action_item_service import ActionItemService
from app.application.services.analysis_service import AIAnalysisService
from app.application.services.recording_service import RecordingService
from app.application.services.transcription_service import TranscriptionService
from app.config.settings import Settings
from app.domain.models.enums import ActionItemStatus, AudioSourceType
from app.infrastructure.audio.recorder import RecordingResult
from app.infrastructure.audio.wav_writer import write_silence_wav
from tests.conftest import FakeAIProvider, FakeDiarization, FakeTranscriptionProvider


@pytest.mark.asyncio
async def test_action_items_from_analysis_and_status_update(uow_factory, settings: Settings) -> None:
    recordings = RecordingService(uow_factory, settings)
    wav = settings.recordings_path / "z.wav"
    write_silence_wav(wav, 0.2)
    recording = recordings.create_from_capture(
        RecordingResult(path=wav, duration_seconds=0.2, bytes_written=wav.stat().st_size),
        "Engineering",
        AudioSourceType.MICROPHONE,
    )
    transcriptions = TranscriptionService(
        uow_factory, FakeTranscriptionProvider(), FakeDiarization(), settings.max_recording_bytes
    )
    await transcriptions.transcribe(recording.id)
    await AIAnalysisService(uow_factory, FakeAIProvider()).analyze(recording.id)
    service = ActionItemService(uow_factory)
    items = service.list()
    assert len(items) == 1
    assert items[0].task == "Prepare migration script"
    assert items[0].owner == "John"
    assert items[0].recording_title == "Engineering"
    updated = service.update_status(items[0].id, ActionItemStatus.COMPLETED)
    assert updated.status == ActionItemStatus.COMPLETED
    pending = service.list(status=ActionItemStatus.PENDING)
    assert pending == []
