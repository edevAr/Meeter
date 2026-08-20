from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field

from app.domain.models.enums import ActionItemPriority, ActionItemStatus


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Task(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    title: str
    details: str = ""
    due_date: str | None = None
    priority: ActionItemPriority = ActionItemPriority.MEDIUM
    status: ActionItemStatus = ActionItemStatus.PENDING
    source: str = "manual"
    note_id: str | None = None
    recording_id: str | None = None
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    model_config = {"from_attributes": True}
