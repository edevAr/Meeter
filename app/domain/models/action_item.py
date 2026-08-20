from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field

from app.domain.models.enums import ActionItemPriority, ActionItemStatus


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class ActionItem(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    analysis_id: str
    recording_id: str
    recording_title: str | None = None
    task: str
    owner: str | None = None
    due_date: str | None = None
    priority: ActionItemPriority = ActionItemPriority.MEDIUM
    status: ActionItemStatus = ActionItemStatus.PENDING
    created_at: datetime = Field(default_factory=utcnow)
    updated_at: datetime = Field(default_factory=utcnow)

    model_config = {"from_attributes": True}

    def display_owner(self) -> str:
        return self.owner or "Not specified"

    def display_due(self) -> str:
        return self.due_date or "Not specified"
