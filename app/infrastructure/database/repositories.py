from __future__ import annotations

from datetime import datetime, timezone
from typing import Sequence

from sqlalchemy import func, or_, select
from sqlalchemy.orm import Session, selectinload

from app.domain.interfaces.repositories import (
    ActionItemRepository,
    AnalysisRepository,
    RecordingRepository,
    TranscriptRepository,
    UnitOfWork,
)
from app.domain.models.action_item import ActionItem
from app.domain.models.analysis import Decision, KeyTopic, MeetingAnalysis
from app.domain.models.enums import ActionItemPriority, ActionItemStatus, AudioSourceType, RecordingStatus
from app.domain.models.note import Note, NoteShare
from app.domain.models.recording import Recording
from app.domain.models.task import Task
from app.domain.models.transcript import Transcript, TranscriptSegment
from app.infrastructure.database.models import (
    ActionItemRow,
    AnalysisRow,
    DecisionRow,
    NoteRow,
    NoteShareRow,
    RecordingRow,
    TaskRow,
    TopicRow,
    TranscriptRow,
    TranscriptSegmentRow,
    UserRow,
)
from app.infrastructure.database.session import SessionFactory


def _aware(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def recording_from_row(row: RecordingRow) -> Recording:
    return Recording(
        id=row.id,
        title=row.title,
        file_path=row.file_path,
        duration_seconds=row.duration_seconds,
        created_at=_aware(row.created_at),  # type: ignore[arg-type]
        updated_at=_aware(row.updated_at),  # type: ignore[arg-type]
        status=RecordingStatus(row.status),
        source=AudioSourceType(row.source),
        sample_rate=row.sample_rate,
        channels=row.channels,
        sample_width=row.sample_width,
        language=row.language,
        file_size_bytes=row.file_size_bytes,
        error_message=row.error_message,
        device_name=row.device_name,
    )


def _apply_recording(row: RecordingRow, recording: Recording) -> None:
    row.title = recording.title
    row.file_path = recording.file_path
    row.duration_seconds = recording.duration_seconds
    row.created_at = recording.created_at
    row.updated_at = recording.updated_at
    row.status = recording.status.value
    row.source = recording.source.value
    row.sample_rate = recording.sample_rate
    row.channels = recording.channels
    row.sample_width = recording.sample_width
    row.language = recording.language
    row.file_size_bytes = recording.file_size_bytes
    row.error_message = recording.error_message
    row.device_name = recording.device_name


def transcript_from_row(row: TranscriptRow) -> Transcript:
    segments = [
        TranscriptSegment(
            id=seg.id,
            transcript_id=seg.transcript_id,
            start_time=seg.start_time,
            end_time=seg.end_time,
            speaker=seg.speaker,
            text=seg.text,
            sequence=seg.sequence,
        )
        for seg in sorted(row.segments, key=lambda s: s.sequence)
    ]
    return Transcript(
        id=row.id,
        recording_id=row.recording_id,
        text=row.text,
        language=row.language,
        created_at=_aware(row.created_at),  # type: ignore[arg-type]
        provider=row.provider,
        model_name=row.model_name,
        segments=segments,
    )


def analysis_from_row(row: AnalysisRow) -> MeetingAnalysis:
    return MeetingAnalysis(
        id=row.id,
        recording_id=row.recording_id,
        transcript_id=row.transcript_id,
        summary=row.summary,
        created_at=_aware(row.created_at),  # type: ignore[arg-type]
        provider=row.provider,
        model_name=row.model_name,
        participants=list(row.participants or []),
        key_topics=[
            KeyTopic(id=t.id, analysis_id=t.analysis_id, topic=t.topic, sequence=t.sequence)
            for t in sorted(row.topics, key=lambda x: x.sequence)
        ],
        decisions=[
            Decision(id=d.id, analysis_id=d.analysis_id, text=d.text, sequence=d.sequence)
            for d in sorted(row.decisions, key=lambda x: x.sequence)
        ],
    )


def action_item_from_row(row: ActionItemRow, recording_title: str | None = None) -> ActionItem:
    title = recording_title
    if title is None and row.recording is not None:
        title = row.recording.title
    return ActionItem(
        id=row.id,
        analysis_id=row.analysis_id,
        recording_id=row.recording_id,
        recording_title=title,
        task=row.task,
        owner=row.owner,
        due_date=row.due_date,
        priority=ActionItemPriority(row.priority),
        status=ActionItemStatus(row.status),
        created_at=_aware(row.created_at),  # type: ignore[arg-type]
        updated_at=_aware(row.updated_at),  # type: ignore[arg-type]
    )


class SqlAlchemyRecordingRepository(RecordingRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, recording: Recording) -> Recording:
        row = RecordingRow(id=recording.id)
        _apply_recording(row, recording)
        self._session.add(row)
        self._session.flush()
        return recording

    def get(self, recording_id: str) -> Recording | None:
        row = self._session.get(RecordingRow, recording_id)
        return recording_from_row(row) if row else None

    def list(self, limit: int = 200, offset: int = 0) -> list[Recording]:
        stmt = (
            select(RecordingRow)
            .order_by(RecordingRow.created_at.desc())
            .offset(offset)
            .limit(limit)
        )
        return [recording_from_row(r) for r in self._session.scalars(stmt)]

    def update(self, recording: Recording) -> Recording:
        row = self._session.get(RecordingRow, recording.id)
        if row is None:
            raise KeyError(recording.id)
        _apply_recording(row, recording)
        self._session.flush()
        return recording

    def delete(self, recording_id: str) -> None:
        row = self._session.get(RecordingRow, recording_id)
        if row is not None:
            self._session.delete(row)

    def search_by_title(self, query: str) -> list[Recording]:
        pattern = f"%{query}%"
        stmt = (
            select(RecordingRow)
            .where(RecordingRow.title.ilike(pattern))
            .order_by(RecordingRow.created_at.desc())
        )
        return [recording_from_row(r) for r in self._session.scalars(stmt)]

    def counts(self) -> dict[str, int]:
        total = self._session.scalar(select(func.count()).select_from(RecordingRow)) or 0
        transcribed = self._session.scalar(
            select(func.count()).select_from(RecordingRow).where(
                RecordingRow.status.in_(
                    [
                        RecordingStatus.TRANSCRIBED.value,
                        RecordingStatus.ANALYZING.value,
                        RecordingStatus.ANALYZED.value,
                    ]
                )
            )
        ) or 0
        analyzed = self._session.scalar(
            select(func.count()).select_from(RecordingRow).where(
                RecordingRow.status == RecordingStatus.ANALYZED.value
            )
        ) or 0
        return {"recordings": int(total), "transcribed": int(transcribed), "analyzed": int(analyzed)}


class SqlAlchemyTranscriptRepository(TranscriptRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, transcript: Transcript) -> Transcript:
        existing = self._session.scalar(
            select(TranscriptRow).where(TranscriptRow.recording_id == transcript.recording_id)
        )
        if existing is not None:
            self._session.delete(existing)
            self._session.flush()
        row = TranscriptRow(
            id=transcript.id,
            recording_id=transcript.recording_id,
            text=transcript.text,
            language=transcript.language,
            created_at=transcript.created_at,
            provider=transcript.provider,
            model_name=transcript.model_name,
        )
        for seg in transcript.segments:
            row.segments.append(
                TranscriptSegmentRow(
                    id=seg.id,
                    transcript_id=transcript.id,
                    start_time=seg.start_time,
                    end_time=seg.end_time,
                    speaker=seg.speaker,
                    text=seg.text,
                    sequence=seg.sequence,
                )
            )
        self._session.add(row)
        self._session.flush()
        return transcript

    def get_by_recording(self, recording_id: str) -> Transcript | None:
        stmt = (
            select(TranscriptRow)
            .options(selectinload(TranscriptRow.segments))
            .where(TranscriptRow.recording_id == recording_id)
        )
        row = self._session.scalar(stmt)
        return transcript_from_row(row) if row else None

    def delete_by_recording(self, recording_id: str) -> None:
        row = self._session.scalar(
            select(TranscriptRow).where(TranscriptRow.recording_id == recording_id)
        )
        if row is not None:
            self._session.delete(row)

    def search_text(self, query: str) -> list[Transcript]:
        pattern = f"%{query}%"
        stmt = (
            select(TranscriptRow)
            .options(selectinload(TranscriptRow.segments))
            .where(TranscriptRow.text.ilike(pattern))
        )
        return [transcript_from_row(r) for r in self._session.scalars(stmt)]


class SqlAlchemyAnalysisRepository(AnalysisRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, analysis: MeetingAnalysis) -> MeetingAnalysis:
        existing = self._session.scalar(
            select(AnalysisRow).where(AnalysisRow.recording_id == analysis.recording_id)
        )
        if existing is not None:
            self._session.delete(existing)
            self._session.flush()
        row = AnalysisRow(
            id=analysis.id,
            recording_id=analysis.recording_id,
            transcript_id=analysis.transcript_id,
            summary=analysis.summary,
            created_at=analysis.created_at,
            provider=analysis.provider,
            model_name=analysis.model_name,
            participants=analysis.participants,
        )
        for topic in analysis.key_topics:
            row.topics.append(
                TopicRow(
                    id=topic.id,
                    analysis_id=analysis.id,
                    topic=topic.topic,
                    sequence=topic.sequence,
                )
            )
        for decision in analysis.decisions:
            row.decisions.append(
                DecisionRow(
                    id=decision.id,
                    analysis_id=analysis.id,
                    text=decision.text,
                    sequence=decision.sequence,
                )
            )
        self._session.add(row)
        self._session.flush()
        return analysis

    def get_by_recording(self, recording_id: str) -> MeetingAnalysis | None:
        stmt = (
            select(AnalysisRow)
            .options(selectinload(AnalysisRow.topics), selectinload(AnalysisRow.decisions))
            .where(AnalysisRow.recording_id == recording_id)
        )
        row = self._session.scalar(stmt)
        return analysis_from_row(row) if row else None

    def delete_by_recording(self, recording_id: str) -> None:
        row = self._session.scalar(
            select(AnalysisRow).where(AnalysisRow.recording_id == recording_id)
        )
        if row is not None:
            self._session.delete(row)

    def search_topics(self, query: str) -> list[MeetingAnalysis]:
        pattern = f"%{query}%"
        stmt = (
            select(AnalysisRow)
            .join(TopicRow, isouter=True)
            .options(selectinload(AnalysisRow.topics), selectinload(AnalysisRow.decisions))
            .where(or_(TopicRow.topic.ilike(pattern), AnalysisRow.summary.ilike(pattern)))
            .distinct()
        )
        return [analysis_from_row(r) for r in self._session.scalars(stmt)]


class SqlAlchemyActionItemRepository(ActionItemRepository):
    def __init__(self, session: Session) -> None:
        self._session = session

    def add_many(self, items: Sequence[ActionItem]) -> list[ActionItem]:
        rows = []
        for item in items:
            rows.append(
                ActionItemRow(
                    id=item.id,
                    analysis_id=item.analysis_id,
                    recording_id=item.recording_id,
                    task=item.task,
                    owner=item.owner,
                    due_date=item.due_date,
                    priority=item.priority.value,
                    status=item.status.value,
                    created_at=item.created_at,
                    updated_at=item.updated_at,
                )
            )
        self._session.add_all(rows)
        self._session.flush()
        return list(items)

    def list(
        self,
        status: ActionItemStatus | None = None,
        priority: ActionItemPriority | None = None,
    ) -> list[ActionItem]:
        stmt = select(ActionItemRow).options(selectinload(ActionItemRow.recording))
        if status is not None:
            stmt = stmt.where(ActionItemRow.status == status.value)
        if priority is not None:
            stmt = stmt.where(ActionItemRow.priority == priority.value)
        stmt = stmt.order_by(ActionItemRow.created_at.desc())
        return [action_item_from_row(r) for r in self._session.scalars(stmt)]

    def get(self, item_id: str) -> ActionItem | None:
        row = self._session.get(ActionItemRow, item_id)
        if row is None:
            return None
        if row.recording is None:
            self._session.refresh(row, ["recording"])
        return action_item_from_row(row)

    def update(self, item: ActionItem) -> ActionItem:
        row = self._session.get(ActionItemRow, item.id)
        if row is None:
            raise KeyError(item.id)
        row.task = item.task
        row.owner = item.owner
        row.due_date = item.due_date
        row.priority = item.priority.value
        row.status = item.status.value
        row.updated_at = item.updated_at
        self._session.flush()
        return item

    def delete_by_recording(self, recording_id: str) -> None:
        rows = self._session.scalars(
            select(ActionItemRow).where(ActionItemRow.recording_id == recording_id)
        )
        for row in rows:
            self._session.delete(row)

    def search(self, query: str) -> list[ActionItem]:
        pattern = f"%{query}%"
        stmt = (
            select(ActionItemRow)
            .options(selectinload(ActionItemRow.recording))
            .where(
                or_(
                    ActionItemRow.task.ilike(pattern),
                    ActionItemRow.owner.ilike(pattern),
                )
            )
        )
        return [action_item_from_row(r) for r in self._session.scalars(stmt)]


def note_from_row(row: NoteRow) -> Note:
    return Note(
        id=row.id,
        title=row.title,
        body=row.body,
        color=row.color,
        pinned=bool(row.pinned),
        archived=bool(row.archived),
        recording_id=row.recording_id,
        priority=int(getattr(row, "priority", 3) or 3),
        pos_x=float(getattr(row, "pos_x", 72) or 72),
        pos_y=float(getattr(row, "pos_y", 72) or 72),
        rotation=float(getattr(row, "rotation", -1.5) or -1.5),
        width=float(getattr(row, "width", 248) or 248),
        height=float(getattr(row, "height", 280) or 280),
        reminder_at=_aware(getattr(row, "reminder_at", None)) if getattr(row, "reminder_at", None) else None,
        alarm_tone=getattr(row, "alarm_tone", None) or "classic",
        reminder_silenced=bool(getattr(row, "reminder_silenced", False)),
        user_id=getattr(row, "user_id", None),
        created_at=_aware(row.created_at),  # type: ignore[arg-type]
        updated_at=_aware(row.updated_at),  # type: ignore[arg-type]
    )


def share_from_row(row: NoteShareRow, user: UserRow | None = None) -> NoteShare:
    return NoteShare(
        id=row.id,
        note_id=row.note_id,
        user_id=row.user_id,
        can_read=bool(row.can_read) or bool(row.can_write),
        can_write=bool(row.can_write),
        created_at=_aware(row.created_at),  # type: ignore[arg-type]
        name=(user.name if user else "") or "",
        email=(user.email if user else "") or "",
    )


def task_from_row(row: TaskRow) -> Task:
    return Task(
        id=row.id,
        title=row.title,
        details=row.details or "",
        due_date=row.due_date,
        priority=ActionItemPriority(row.priority),
        status=ActionItemStatus(row.status),
        source=row.source,
        note_id=row.note_id,
        recording_id=row.recording_id,
        created_at=_aware(row.created_at),  # type: ignore[arg-type]
        updated_at=_aware(row.updated_at),  # type: ignore[arg-type]
    )


class SqlAlchemyNoteRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, note: Note) -> Note:
        self._session.add(
            NoteRow(
                id=note.id,
                title=note.title,
                body=note.body,
                color=note.color,
                pinned=note.pinned,
                archived=note.archived,
                recording_id=note.recording_id,
                priority=note.priority,
                pos_x=note.pos_x,
                pos_y=note.pos_y,
                rotation=note.rotation,
                width=note.width,
                height=note.height,
                reminder_at=note.reminder_at,
                alarm_tone=note.alarm_tone,
                reminder_silenced=bool(note.reminder_silenced),
                user_id=note.user_id,
                created_at=note.created_at,
                updated_at=note.updated_at,
            )
        )
        self._session.flush()
        return note

    def get(self, note_id: str) -> Note | None:
        row = self._session.get(NoteRow, note_id)
        return note_from_row(row) if row else None

    def list(self, archived: bool = False, user_id: str | None = None) -> list[Note]:
        stmt = select(NoteRow).where(NoteRow.archived.is_(archived))
        if user_id:
            if archived:
                stmt = stmt.where(NoteRow.user_id == user_id)
            else:
                shared_ids = select(NoteShareRow.note_id).where(
                    NoteShareRow.user_id == user_id,
                    or_(NoteShareRow.can_read.is_(True), NoteShareRow.can_write.is_(True)),
                )
                stmt = stmt.where(or_(NoteRow.user_id == user_id, NoteRow.id.in_(shared_ids)))
        stmt = stmt.order_by(NoteRow.pinned.desc(), NoteRow.updated_at.desc())
        return [note_from_row(row) for row in self._session.scalars(stmt)]

    def update(self, note: Note) -> Note:
        row = self._session.get(NoteRow, note.id)
        if row is None:
            raise KeyError(note.id)
        row.title = note.title
        row.body = note.body
        row.color = note.color
        row.pinned = note.pinned
        row.archived = note.archived
        row.recording_id = note.recording_id
        row.priority = note.priority
        row.pos_x = note.pos_x
        row.pos_y = note.pos_y
        row.rotation = note.rotation
        row.width = note.width
        row.height = note.height
        row.reminder_at = note.reminder_at
        row.alarm_tone = note.alarm_tone or "classic"
        row.reminder_silenced = bool(note.reminder_silenced)
        row.user_id = note.user_id
        row.created_at = note.created_at
        row.updated_at = note.updated_at
        self._session.flush()
        return note

    def delete(self, note_id: str) -> None:
        row = self._session.get(NoteRow, note_id)
        if row is not None:
            self._session.delete(row)

    def search(self, query: str) -> list[Note]:
        pattern = f"%{query}%"
        stmt = select(NoteRow).where(
            or_(NoteRow.title.ilike(pattern), NoteRow.body.ilike(pattern))
        )
        return [note_from_row(row) for row in self._session.scalars(stmt)]

    def share_for(self, note_id: str, user_id: str) -> NoteShare | None:
        row = self._session.scalar(
            select(NoteShareRow).where(NoteShareRow.note_id == note_id, NoteShareRow.user_id == user_id)
        )
        return share_from_row(row) if row else None

    def shares_for_user(self, user_id: str) -> dict[str, NoteShare]:
        rows = self._session.scalars(select(NoteShareRow).where(NoteShareRow.user_id == user_id))
        return {row.note_id: share_from_row(row) for row in rows}

    def share_counts(self, note_ids: list[str]) -> dict[str, int]:
        if not note_ids:
            return {}
        rows = self._session.execute(
            select(NoteShareRow.note_id, func.count())
            .where(NoteShareRow.note_id.in_(note_ids))
            .group_by(NoteShareRow.note_id)
        )
        return {note_id: int(count) for note_id, count in rows}

    def list_shares(self, note_id: str) -> list[NoteShare]:
        rows = list(
            self._session.scalars(
                select(NoteShareRow)
                .where(NoteShareRow.note_id == note_id)
                .order_by(NoteShareRow.created_at.asc())
            )
        )
        user_ids = [row.user_id for row in rows]
        users: dict[str, UserRow] = {}
        if user_ids:
            users = {
                user.id: user
                for user in self._session.scalars(select(UserRow).where(UserRow.id.in_(user_ids)))
            }
        return [share_from_row(row, users.get(row.user_id)) for row in rows]

    def get_share(self, share_id: str) -> NoteShare | None:
        row = self._session.get(NoteShareRow, share_id)
        if row is None:
            return None
        user = self._session.get(UserRow, row.user_id)
        return share_from_row(row, user)

    def add_share(self, share: NoteShare) -> NoteShare:
        self._session.add(
            NoteShareRow(
                id=share.id,
                note_id=share.note_id,
                user_id=share.user_id,
                can_read=bool(share.can_read) or bool(share.can_write),
                can_write=bool(share.can_write),
                created_at=share.created_at,
            )
        )
        self._session.flush()
        return share

    def update_share(self, share: NoteShare) -> NoteShare:
        row = self._session.get(NoteShareRow, share.id)
        if row is None:
            raise KeyError(share.id)
        row.can_read = bool(share.can_read) or bool(share.can_write)
        row.can_write = bool(share.can_write)
        self._session.flush()
        user = self._session.get(UserRow, row.user_id)
        return share_from_row(row, user)

    def delete_share(self, share_id: str) -> None:
        row = self._session.get(NoteShareRow, share_id)
        if row is not None:
            self._session.delete(row)


class SqlAlchemyTaskRepository:
    def __init__(self, session: Session) -> None:
        self._session = session

    def add(self, task: Task) -> Task:
        self._session.add(
            TaskRow(
                id=task.id,
                title=task.title,
                details=task.details,
                due_date=task.due_date,
                priority=task.priority.value,
                status=task.status.value,
                source=task.source,
                note_id=task.note_id,
                recording_id=task.recording_id,
                created_at=task.created_at,
                updated_at=task.updated_at,
            )
        )
        self._session.flush()
        return task

    def get(self, task_id: str) -> Task | None:
        row = self._session.get(TaskRow, task_id)
        return task_from_row(row) if row else None

    def list(
        self,
        status: ActionItemStatus | None = None,
        priority: ActionItemPriority | None = None,
    ) -> list[Task]:
        stmt = select(TaskRow)
        if status is not None:
            stmt = stmt.where(TaskRow.status == status.value)
        if priority is not None:
            stmt = stmt.where(TaskRow.priority == priority.value)
        stmt = stmt.order_by(TaskRow.due_date.is_(None), TaskRow.due_date.asc(), TaskRow.created_at.desc())
        return [task_from_row(row) for row in self._session.scalars(stmt)]

    def update(self, task: Task) -> Task:
        row = self._session.get(TaskRow, task.id)
        if row is None:
            raise KeyError(task.id)
        row.title = task.title
        row.details = task.details
        row.due_date = task.due_date
        row.priority = task.priority.value
        row.status = task.status.value
        row.source = task.source
        row.note_id = task.note_id
        row.recording_id = task.recording_id
        row.updated_at = task.updated_at
        self._session.flush()
        return task

    def delete(self, task_id: str) -> None:
        row = self._session.get(TaskRow, task_id)
        if row is not None:
            self._session.delete(row)

    def search(self, query: str) -> list[Task]:
        pattern = f"%{query}%"
        stmt = select(TaskRow).where(
            or_(TaskRow.title.ilike(pattern), TaskRow.details.ilike(pattern))
        )
        return [task_from_row(row) for row in self._session.scalars(stmt)]


class SqlAlchemyUnitOfWork(UnitOfWork):
    def __init__(self, session_factory: SessionFactory) -> None:
        self._session_factory = session_factory
        self._session: Session | None = None

    def __enter__(self) -> SqlAlchemyUnitOfWork:
        self._session = self._session_factory()
        self.recordings = SqlAlchemyRecordingRepository(self._session)
        self.transcripts = SqlAlchemyTranscriptRepository(self._session)
        self.analyses = SqlAlchemyAnalysisRepository(self._session)
        self.action_items = SqlAlchemyActionItemRepository(self._session)
        self.notes = SqlAlchemyNoteRepository(self._session)
        self.tasks = SqlAlchemyTaskRepository(self._session)
        return self

    def __exit__(self, exc_type, exc, tb) -> None:
        if exc_type is not None:
            self.rollback()
        if self._session is not None:
            self._session.close()
            self._session = None

    def commit(self) -> None:
        assert self._session is not None
        self._session.commit()

    def rollback(self) -> None:
        if self._session is not None:
            self._session.rollback()
