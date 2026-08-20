from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class TranscriptSegment(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    transcript_id: str
    start_time: float = 0.0
    end_time: float = 0.0
    speaker: str | None = None
    text: str
    sequence: int = 0

    model_config = {"from_attributes": True}


class Transcript(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    recording_id: str
    text: str
    language: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    provider: str = "whisper"
    model_name: str | None = None
    segments: list[TranscriptSegment] = Field(default_factory=list)

    model_config = {"from_attributes": True}
