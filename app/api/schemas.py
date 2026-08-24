from __future__ import annotations

from datetime import datetime

from pydantic import BaseModel, Field

from app.domain.models.enums import ActionItemPriority, ActionItemStatus, AudioSourceType, RecordingStatus


class RegisterIn(BaseModel):
    email: str
    password: str
    name: str = ""


class LoginIn(BaseModel):
    email: str
    password: str


class ForgotPasswordIn(BaseModel):
    email: str


class ResetPasswordIn(BaseModel):
    email: str
    code: str
    password: str


class UserOut(BaseModel):
    id: str
    email: str
    name: str


class SessionOut(BaseModel):
    token: str
    user: UserOut


class ForgotPasswordOut(BaseModel):
    detail: str
    reset_code: str | None = None



class RecordingCreate(BaseModel):
    title: str = "Untitled recording"
    source: AudioSourceType = AudioSourceType.MICROPHONE
    file_path: str | None = None
    duration_seconds: float = 0.0


class RecordingOut(BaseModel):
    id: str
    title: str
    file_path: str
    audio_url: str
    duration_seconds: float
    created_at: datetime
    updated_at: datetime
    status: RecordingStatus
    source: AudioSourceType
    language: str | None
    file_size_bytes: int
    error_message: str | None
    device_name: str | None


class TranscriptSegmentOut(BaseModel):
    id: str
    start_time: float
    end_time: float
    speaker: str | None
    text: str
    sequence: int


class TranscriptOut(BaseModel):
    id: str
    recording_id: str
    text: str
    language: str | None
    created_at: datetime
    provider: str
    model_name: str | None
    segments: list[TranscriptSegmentOut] = Field(default_factory=list)


class ActionItemOut(BaseModel):
    id: str
    analysis_id: str
    recording_id: str
    recording_title: str | None
    task: str
    owner: str | None
    due_date: str | None
    priority: ActionItemPriority
    status: ActionItemStatus
    created_at: datetime
    updated_at: datetime


class ActionItemPatch(BaseModel):
    status: ActionItemStatus | None = None
    owner: str | None = None
    due_date: str | None = None
    priority: ActionItemPriority | None = None
    task: str | None = None


class AnalysisOut(BaseModel):
    id: str
    recording_id: str
    transcript_id: str
    summary: str
    created_at: datetime
    provider: str
    model_name: str | None
    participants: list[str]
    key_topics: list[str]
    decisions: list[str]


class TranscribeRequest(BaseModel):
    language: str | None = None


class DashboardOut(BaseModel):
    recordings: int
    transcribed: int
    analyzed: int
    recent: list[RecordingOut]


class SearchHitOut(BaseModel):
    kind: str
    id: str
    recording_id: str
    title: str
    snippet: str


class SearchOut(BaseModel):
    query: str
    results: list[SearchHitOut]


class MetaOut(BaseModel):
    transcription_provider: str
    transcription_is_cloud: bool
    allow_cloud_transcription: bool
    ai_provider: str
    ai_model: str
    ai_is_cloud: bool
    default_language: str
    api_key_configured: bool


class MessageOut(BaseModel):
    detail: str


class CallNoteCreate(BaseModel):
    transcript: str = ""
    title: str | None = None
    created_at: datetime | None = None
    pos_x: float = 48
    pos_y: float = 140
    color: str = "amber"
    recording_id: str | None = None


class NoteCreate(BaseModel):
    title: str = ""
    body: str = ""
    color: str = "yellow"
    pinned: bool = False
    recording_id: str | None = None
    priority: int = 1
    pos_x: float = 72
    pos_y: float = 72
    rotation: float = -1.5
    width: float = 248
    height: float = 280
    created_at: datetime | None = None
    reminder_at: datetime | None = None
    alarm_tone: str = "classic"
    reminder_silenced: bool = False


class NotePatch(BaseModel):
    title: str | None = None
    body: str | None = None
    color: str | None = None
    pinned: bool | None = None
    archived: bool | None = None
    priority: int | None = None
    pos_x: float | None = None
    pos_y: float | None = None
    rotation: float | None = None
    width: float | None = None
    height: float | None = None
    created_at: datetime | None = None
    reminder_at: datetime | None = None
    alarm_tone: str | None = None
    reminder_silenced: bool | None = None


class NoteOut(BaseModel):
    id: str
    title: str
    body: str
    color: str
    pinned: bool
    archived: bool
    recording_id: str | None
    priority: int = 1
    pos_x: float = 72
    pos_y: float = 72
    rotation: float = -1.5
    width: float = 248
    height: float = 280
    reminder_at: datetime | None = None
    alarm_tone: str = "classic"
    reminder_silenced: bool = False
    created_at: datetime
    updated_at: datetime
    access: str = "owner"
    owner_name: str | None = None
    share_count: int = 0


class NoteShareIn(BaseModel):
    identifier: str
    can_read: bool = True
    can_write: bool = False


class NoteSharePatch(BaseModel):
    can_read: bool | None = None
    can_write: bool | None = None


class NoteShareOut(BaseModel):
    id: str
    note_id: str
    user_id: str
    name: str
    email: str
    can_read: bool
    can_write: bool
    created_at: datetime


class TaskCreate(BaseModel):
    title: str
    details: str = ""
    due_date: str | None = None
    priority: ActionItemPriority = ActionItemPriority.MEDIUM
    source: str = "manual"
    note_id: str | None = None
    recording_id: str | None = None


class TaskPatch(BaseModel):
    title: str | None = None
    details: str | None = None
    due_date: str | None = None
    priority: ActionItemPriority | None = None
    status: ActionItemStatus | None = None


class TaskOut(BaseModel):
    id: str
    title: str
    details: str
    due_date: str | None
    priority: ActionItemPriority
    status: ActionItemStatus
    source: str
    note_id: str | None
    recording_id: str | None
    created_at: datetime
    updated_at: datetime


class AgendaItemOut(BaseModel):
    id: str
    kind: str
    title: str
    details: str
    due_date: str | None
    priority: ActionItemPriority
    status: ActionItemStatus
    source: str
    recording_id: str | None = None
    note_id: str | None = None
    overdue: bool = False


class AgendaOut(BaseModel):
    period: str
    items: list[AgendaItemOut]


class RecordingNotesCreate(BaseModel):
    include_summary: bool = True
    include_decisions: bool = True
    include_topics: bool = False
    include_action_items: bool = True
    create_tasks: bool = True

