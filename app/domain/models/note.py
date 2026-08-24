from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Note(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str = ""
    body: str = ""
    color: str = "yellow"
    pinned: bool = False
    archived: bool = False
    recording_id: str | None = None
    priority: int = 1
    pos_x: float = 72
    pos_y: float = 72
    rotation: float = -1.5
    width: float = 248
    height: float = 280
    reminder_at: datetime | None = None
    alarm_tone: str = "classic"
    reminder_silenced: bool = False
    user_id: str | None = None
    access: str = "owner"
    owner_name: str | None = None
    share_count: int = 0
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    model_config = {"from_attributes": True}


class NoteShare(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    note_id: str
    user_id: str
    can_read: bool = True
    can_write: bool = False
    created_at: datetime = Field(default_factory=utcnow)
    name: str = ""
    email: str = ""

    model_config = {"from_attributes": True}
