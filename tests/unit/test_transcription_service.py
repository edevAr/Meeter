from __future__ import annotations

import pytest

from app.application.services.transcription_service import TranscriptionService
from app.config.settings import Settings
from app.domain.models.enums import AudioSourceType, RecordingStatus
from app.application.services.recording_service import RecordingService
from app.infrastructure.audio.recorder import RecordingResult
from app.infrastructure.audio.wav_writer import write_silence_wav
from tests.conftest import FakeDiarization, FakeTranscriptionProvider


@pytest.mark.asyncio
async def test_transcribe_saves_segments(uow_factory, settings: Settings) -> None:
    recordings = RecordingService(uow_factory, settings)
    wav = settings.recordings_path / "talk.wav"
    write_silence_wav(wav, 0.3)
    recording = recordings.create_from_capture(
        RecordingResult(path=wav, duration_seconds=0.3, bytes_written=wav.stat().st_size),
        "Sync",
        AudioSourceType.MICROPHONE,
    )
    provider = FakeTranscriptionProvider()
    service = TranscriptionService(uow_factory, provider, FakeDiarization(), settings.max_recording_bytes)
    transcript = await service.transcribe(recording.id, language="en")
    assert "Hello everyone" in transcript.text
    assert len(transcript.segments) == 2
    stored = recordings.get(recording.id)
    assert stored is not None
    assert stored.status == RecordingStatus.TRANSCRIBED
    assert provider.calls


@pytest.mark.asyncio
async def test_missing_recording(uow_factory, settings: Settings) -> None:
    service = TranscriptionService(
        uow_factory, FakeTranscriptionProvider(), FakeDiarization(), settings.max_recording_bytes
    )
    with pytest.raises(KeyError):
        await service.transcribe("missing")
