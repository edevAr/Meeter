from __future__ import annotations

from app.config.settings import Settings
from app.domain.interfaces.transcription import TranscriptionProvider
from app.infrastructure.transcription.whisper_provider import (
    FasterWhisperTranscriptionProvider,
    OpenAITranscriptionProvider,
    WhisperTranscriptionProvider,
)


def create_transcription_provider(settings: Settings) -> TranscriptionProvider:
    name = settings.transcription_provider.strip().lower()
    if name in {"openai", "openai-whisper-api", "cloud"}:
        return OpenAITranscriptionProvider(
            api_key=settings.ai_api_key,
            model_name=settings.openai_transcription_model,
            allow_cloud=settings.allow_cloud_transcription,
            max_bytes=settings.max_recording_bytes,
            base_url=settings.ai_base_url or None,
        )
    if name in {"faster-whisper", "faster_whisper"}:
        return FasterWhisperTranscriptionProvider(
            model_name=settings.whisper_model,
            max_bytes=settings.max_recording_bytes,
        )
    return WhisperTranscriptionProvider(
        model_name=settings.whisper_model,
        max_bytes=settings.max_recording_bytes,
    )
