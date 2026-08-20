from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field

from app.domain.models.enums import AudioSourceType, RecordingStatus


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Recording(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    file_path: str
    duration_seconds: float = 0.0
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)
    status: RecordingStatus = RecordingStatus.RECORDED
    source: AudioSourceType = AudioSourceType.MICROPHONE
    sample_rate: int = 16000
    channels: int = 1
    sample_width: int = 2
    language: str | None = None
    file_size_bytes: int = 0
    error_message: str | None = None
    device_name: str | None = None

    model_config = {"from_attributes": True}

    def touch(self) -> None:
        self.updated_at = utcnow()
