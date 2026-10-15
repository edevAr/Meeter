from __future__ import annotations

import pytest

from app.application.services.analysis_service import AIAnalysisService
from app.application.services.recording_service import RecordingService
from app.application.services.transcription_service import TranscriptionService
from app.config.settings import Settings
from app.domain.models.enums import AudioSourceType, RecordingStatus
from app.infrastructure.ai.llm_provider import AIProviderError
from app.infrastructure.audio.recorder import RecordingResult
from app.infrastructure.audio.wav_writer import write_silence_wav
from tests.conftest import FakeAIProvider, FakeDiarization, FakeTranscriptionProvider, SpeakerFakeDiarization


@pytest.mark.asyncio
async def test_analyze_requires_transcript(uow_factory, settings: Settings) -> None:
    recordings = RecordingService(uow_factory, settings)
    wav = settings.recordings_path / "x.wav"
    write_silence_wav(wav, 0.2)
    recording = recordings.create_from_capture(
        RecordingResult(path=wav, duration_seconds=0.2, bytes_written=wav.stat().st_size),
        "X",
        AudioSourceType.MICROPHONE,
    )
    service = AIAnalysisService(uow_factory, FakeAIProvider())
    with pytest.raises(AIProviderError):
        await service.analyze(recording.id)


@pytest.mark.asyncio
async def test_analyze_persists_summary(uow_factory, settings: Settings) -> None:
    recordings = RecordingService(uow_factory, settings)
    wav = settings.recordings_path / "y.wav"
    write_silence_wav(wav, 0.2)
    recording = recordings.create_from_capture(
        RecordingResult(path=wav, duration_seconds=0.2, bytes_written=wav.stat().st_size),
        "Planning",
        AudioSourceType.MICROPHONE,
    )
    transcriptions = TranscriptionService(
        uow_factory, FakeTranscriptionProvider(), FakeDiarization(), settings.max_recording_bytes
    )
    await transcriptions.transcribe(recording.id)
    ai = FakeAIProvider()
    service = AIAnalysisService(uow_factory, ai)
    analysis = await service.analyze(recording.id)
    assert "migration" in analysis.summary.lower()
    assert analysis.key_topics
    assert analysis.decisions
    updated = recordings.get(recording.id)
    assert updated is not None
    assert updated.status == RecordingStatus.ANALYZED
    assert ai.calls


@pytest.mark.asyncio
async def test_analyze_sends_speaker_transcript(uow_factory, settings: Settings) -> None:
    recordings = RecordingService(uow_factory, settings)
    wav = settings.recordings_path / "z.wav"
    write_silence_wav(wav, 0.2)
    recording = recordings.create_from_capture(
        RecordingResult(path=wav, duration_seconds=0.2, bytes_written=wav.stat().st_size),
        "Call",
        AudioSourceType.MICROPHONE,
    )
    transcriptions = TranscriptionService(
        uow_factory, FakeTranscriptionProvider(), SpeakerFakeDiarization(), settings.max_recording_bytes
    )
    await transcriptions.transcribe(recording.id)
    ai = FakeAIProvider()
    service = AIAnalysisService(uow_factory, ai)
    analysis = await service.analyze(recording.id)
    assert ai.calls
    assert "SPEAKER_01" in ai.calls[0]
    assert analysis.participants
