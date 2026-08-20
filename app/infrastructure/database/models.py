from __future__ import annotations

from sqlalchemy import JSON, Boolean, DateTime, Float, ForeignKey, Integer, String, Text
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.infrastructure.database.base import Base


class RecordingRow(Base):
    __tablename__ = "recordings"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), nullable=False)
    file_path: Mapped[str] = mapped_column(String(1024), nullable=False)
    duration_seconds: Mapped[float] = mapped_column(Float, default=0.0)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    source: Mapped[str] = mapped_column(String(32), nullable=False)
    sample_rate: Mapped[int] = mapped_column(Integer, default=16000)
    channels: Mapped[int] = mapped_column(Integer, default=1)
    sample_width: Mapped[int] = mapped_column(Integer, default=2)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    file_size_bytes: Mapped[int] = mapped_column(Integer, default=0)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    device_name: Mapped[str | None] = mapped_column(String(255), nullable=True)

    transcript: Mapped[TranscriptRow | None] = relationship(
        back_populates="recording",
        cascade="all, delete-orphan",
        uselist=False,
    )
    analysis: Mapped[AnalysisRow | None] = relationship(
        back_populates="recording",
        cascade="all, delete-orphan",
        uselist=False,
    )
    action_items: Mapped[list[ActionItemRow]] = relationship(
        back_populates="recording",
        cascade="all, delete-orphan",
    )


class TranscriptRow(Base):
    __tablename__ = "transcripts"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    recording_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("recordings.id", ondelete="CASCADE"), unique=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    language: Mapped[str | None] = mapped_column(String(16), nullable=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), default="whisper")
    model_name: Mapped[str | None] = mapped_column(String(128), nullable=True)

    recording: Mapped[RecordingRow] = relationship(back_populates="transcript")
    segments: Mapped[list[TranscriptSegmentRow]] = relationship(
        back_populates="transcript",
        cascade="all, delete-orphan",
        order_by="TranscriptSegmentRow.sequence",
    )


class TranscriptSegmentRow(Base):
    __tablename__ = "transcript_segments"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    transcript_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("transcripts.id", ondelete="CASCADE"), index=True
    )
    start_time: Mapped[float] = mapped_column(Float, default=0.0)
    end_time: Mapped[float] = mapped_column(Float, default=0.0)
    speaker: Mapped[str | None] = mapped_column(String(64), nullable=True)
    text: Mapped[str] = mapped_column(Text, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=0)

    transcript: Mapped[TranscriptRow] = relationship(back_populates="segments")


class AnalysisRow(Base):
    __tablename__ = "analyses"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    recording_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("recordings.id", ondelete="CASCADE"), unique=True
    )
    transcript_id: Mapped[str] = mapped_column(String(36), ForeignKey("transcripts.id", ondelete="CASCADE"))
    summary: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    provider: Mapped[str] = mapped_column(String(64), default="openai")
    model_name: Mapped[str | None] = mapped_column(String(128), nullable=True)
    participants: Mapped[list] = mapped_column(JSON, default=list)

    recording: Mapped[RecordingRow] = relationship(back_populates="analysis")
    topics: Mapped[list[TopicRow]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan", order_by="TopicRow.sequence"
    )
    decisions: Mapped[list[DecisionRow]] = relationship(
        back_populates="analysis", cascade="all, delete-orphan", order_by="DecisionRow.sequence"
    )


class TopicRow(Base):
    __tablename__ = "key_topics"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    analysis_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("analyses.id", ondelete="CASCADE"), index=True
    )
    topic: Mapped[str] = mapped_column(String(255), nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=0)

    analysis: Mapped[AnalysisRow] = relationship(back_populates="topics")


class DecisionRow(Base):
    __tablename__ = "decisions"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    analysis_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("analyses.id", ondelete="CASCADE"), index=True
    )
    text: Mapped[str] = mapped_column(Text, nullable=False)
    sequence: Mapped[int] = mapped_column(Integer, default=0)

    analysis: Mapped[AnalysisRow] = relationship(back_populates="decisions")


class ActionItemRow(Base):
    __tablename__ = "action_items"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    analysis_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("analyses.id", ondelete="CASCADE"), index=True
    )
    recording_id: Mapped[str] = mapped_column(
        String(36), ForeignKey("recordings.id", ondelete="CASCADE"), index=True
    )
    task: Mapped[str] = mapped_column(Text, nullable=False)
    owner: Mapped[str | None] = mapped_column(String(255), nullable=True)
    due_date: Mapped[str | None] = mapped_column(String(64), nullable=True)
    priority: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)

    recording: Mapped[RecordingRow] = relationship(back_populates="action_items")


class NoteRow(Base):
    __tablename__ = "notes"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(String(255), default="")
    body: Mapped[str] = mapped_column(Text, default="")
    color: Mapped[str] = mapped_column(String(32), default="yellow")
    pinned: Mapped[bool] = mapped_column(Boolean, default=False)
    archived: Mapped[bool] = mapped_column(Boolean, default=False)
    recording_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    priority: Mapped[int] = mapped_column(Integer, default=1)
    pos_x: Mapped[float] = mapped_column(Float, default=72.0)
    pos_y: Mapped[float] = mapped_column(Float, default=72.0)
    rotation: Mapped[float] = mapped_column(Float, default=-1.5)
    width: Mapped[float] = mapped_column(Float, default=248.0)
    height: Mapped[float] = mapped_column(Float, default=280.0)
    reminder_at: Mapped[object | None] = mapped_column(DateTime(timezone=True), nullable=True)
    alarm_tone: Mapped[str] = mapped_column(String(32), default="classic")
    reminder_silenced: Mapped[bool] = mapped_column(Boolean, default=False)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)


class TaskRow(Base):
    __tablename__ = "tasks"

    id: Mapped[str] = mapped_column(String(36), primary_key=True)
    title: Mapped[str] = mapped_column(Text, nullable=False)
    details: Mapped[str] = mapped_column(Text, default="")
    due_date: Mapped[str | None] = mapped_column(String(32), nullable=True, index=True)
    priority: Mapped[str] = mapped_column(String(16), default="medium", index=True)
    status: Mapped[str] = mapped_column(String(16), default="pending", index=True)
    source: Mapped[str] = mapped_column(String(32), default="manual")
    note_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    recording_id: Mapped[str | None] = mapped_column(String(36), nullable=True, index=True)
    created_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
    updated_at: Mapped[object] = mapped_column(DateTime(timezone=True), nullable=False)
