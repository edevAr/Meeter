from __future__ import annotations

from datetime import datetime, timezone
from uuid import uuid4

from pydantic import BaseModel, Field, field_validator

from app.domain.models.enums import ActionItemPriority, ActionItemStatus


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class LLMActionItem(BaseModel):
    task: str
    owner: str | None = None
    due_date: str | None = None
    priority: ActionItemPriority = ActionItemPriority.MEDIUM
    status: ActionItemStatus = ActionItemStatus.PENDING

    @field_validator("owner", "due_date", mode="before")
    @classmethod
    def _blank_to_none(cls, value: object) -> object:
        if value is None:
            return None
        if isinstance(value, str) and value.strip().lower() in {
            "",
            "null",
            "none",
            "not specified",
            "unknown",
            "n/a",
        }:
            return None
        if isinstance(value, str):
            return value.strip()
        return value

    @field_validator("priority", mode="before")
    @classmethod
    def _normalize_priority(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip().lower()
            if normalized in {"low", "medium", "high"}:
                return normalized
            return "medium"
        return value or "medium"

    @field_validator("status", mode="before")
    @classmethod
    def _normalize_status(cls, value: object) -> object:
        if isinstance(value, str):
            normalized = value.strip().lower().replace(" ", "_")
            if normalized in {"pending", "in_progress", "completed"}:
                return normalized
            return "pending"
        return value or "pending"


class MeetingAnalysisResult(BaseModel):
    """Validated structure produced by an LLM. Never trust free-form text alone."""

    summary: str
    key_topics: list[str] = Field(default_factory=list)
    decisions: list[str] = Field(default_factory=list)
    action_items: list[LLMActionItem] = Field(default_factory=list)
    participants: list[str] = Field(default_factory=list)

    @field_validator("key_topics", "decisions", "participants", mode="before")
    @classmethod
    def _coerce_str_list(cls, value: object) -> object:
        if value is None:
            return []
        if isinstance(value, str):
            return [value]
        if isinstance(value, list):
            cleaned: list[str] = []
            for item in value:
                if isinstance(item, dict):
                    text = item.get("text") or item.get("topic") or item.get("decision") or item.get("name")
                    if text:
                        cleaned.append(str(text))
                elif item:
                    cleaned.append(str(item))
            return cleaned
        return []


class KeyTopic(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    analysis_id: str
    topic: str
    sequence: int = 0

    model_config = {"from_attributes": True}


class Decision(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    analysis_id: str
    text: str
    sequence: int = 0

    model_config = {"from_attributes": True}


class MeetingAnalysis(BaseModel):
    id: str = Field(default_factory=lambda: str(uuid4()))
    recording_id: str
    transcript_id: str
    summary: str
    created_at: datetime = Field(default_factory=utcnow)
    provider: str = "openai"
    model_name: str | None = None
    participants: list[str] = Field(default_factory=list)
    key_topics: list[KeyTopic] = Field(default_factory=list)
    decisions: list[Decision] = Field(default_factory=list)

    model_config = {"from_attributes": True}
