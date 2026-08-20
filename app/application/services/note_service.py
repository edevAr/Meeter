from __future__ import annotations

from datetime import datetime, timezone

from app.domain.models.note import Note


class NoteService:
    def __init__(self, uow_factory) -> None:
        self._uow_factory = uow_factory

    def list(self, archived: bool = False) -> list[Note]:
        with self._uow_factory() as uow:
            return uow.notes.list(archived=archived)

    def get(self, note_id: str) -> Note | None:
        with self._uow_factory() as uow:
            return uow.notes.get(note_id)

    def create(
        self,
        *,
        title: str = "",
        body: str = "",
        color: str = "yellow",
        recording_id: str | None = None,
        pinned: bool = False,
        priority: int = 1,
        pos_x: float = 72,
        pos_y: float = 72,
        rotation: float = -1.5,
        width: float = 248,
        height: float = 280,
        created_at: datetime | None = None,
        reminder_at: datetime | None = None,
        alarm_tone: str = "classic",
        reminder_silenced: bool = False,
    ) -> Note:
        stamp = created_at or datetime.now(timezone.utc)
        note = Note(
            title=title.strip(),
            body=body.strip(),
            color=color or "yellow",
            pinned=pinned,
            recording_id=recording_id,
            priority=max(1, min(5, priority)),
            pos_x=pos_x,
            pos_y=pos_y,
            rotation=rotation,
            width=width,
            height=height,
            reminder_at=reminder_at,
            alarm_tone=alarm_tone or "classic",
            reminder_silenced=bool(reminder_silenced),
            created_at=stamp,
            updated_at=stamp,
        )
        with self._uow_factory() as uow:
            uow.notes.add(note)
            uow.commit()
            return note

    def update(self, note: Note) -> Note:
        note.updated_at = datetime.now(timezone.utc)
        with self._uow_factory() as uow:
            saved = uow.notes.update(note)
            uow.commit()
            return saved

    def delete(self, note_id: str) -> None:
        with self._uow_factory() as uow:
            if uow.notes.get(note_id) is None:
                raise KeyError(note_id)
            uow.notes.delete(note_id)
            uow.commit()

    def from_recording(
        self,
        *,
        recording_id: str,
        title: str,
        body: str,
        color: str = "yellow",
    ) -> Note:
        return self.create(title=title, body=body, color=color, recording_id=recording_id)
