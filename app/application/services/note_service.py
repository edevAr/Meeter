from __future__ import annotations

from datetime import datetime, timezone

from app.application.services.auth_service import AuthError, AuthService
from app.domain.models.note import Note, NoteShare


class NoteAccessError(Exception):
    def __init__(self, message: str, status_code: int = 403) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


class NoteService:
    def __init__(self, uow_factory, auth: AuthService | None = None) -> None:
        self._uow_factory = uow_factory
        self._auth = auth

    def list(self, archived: bool = False, user_id: str | None = None) -> list[Note]:
        with self._uow_factory() as uow:
            return uow.notes.list(archived=archived, user_id=user_id)

    def list_for_board(self, archived: bool = False, user_id: str | None = None) -> list[Note]:
        with self._uow_factory() as uow:
            notes = uow.notes.list(archived=archived, user_id=user_id)
            mine = uow.notes.shares_for_user(user_id) if user_id else {}
            counts = uow.notes.share_counts([note.id for note in notes])
        owners = self._users_by_ids([note.user_id for note in notes if note.user_id])
        enriched: list[Note] = []
        for note in notes:
            owner = owners.get(note.user_id or "")
            share = mine.get(note.id)
            if not user_id or note.user_id == user_id or not note.user_id:
                access = "owner"
            elif share and share.can_write:
                access = "write"
            else:
                access = "read"
            enriched.append(
                note.model_copy(
                    update={
                        "access": access,
                        "owner_name": owner.name if owner else None,
                        "share_count": counts.get(note.id, 0),
                    }
                )
            )
        return enriched

    def get(self, note_id: str, user_id: str | None = None) -> Note | None:
        with self._uow_factory() as uow:
            note = uow.notes.get(note_id)
            if note is None:
                return None
            if user_id and note.user_id and note.user_id != user_id:
                share = uow.notes.share_for(note_id, user_id)
                if share is None or not (share.can_read or share.can_write):
                    return None
            return note

    def access_of(self, note_id: str, user_id: str) -> str | None:
        with self._uow_factory() as uow:
            note = uow.notes.get(note_id)
            if note is None:
                return None
            if not note.user_id or note.user_id == user_id:
                return "owner"
            share = uow.notes.share_for(note_id, user_id)
            if share is None:
                return None
            if share.can_write:
                return "write"
            if share.can_read:
                return "read"
            return None

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
        user_id: str | None = None,
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
            user_id=user_id,
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

    def delete(self, note_id: str, user_id: str | None = None) -> None:
        with self._uow_factory() as uow:
            note = uow.notes.get(note_id)
            if note is None or (user_id and note.user_id and note.user_id != user_id):
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

    def list_shares(self, note_id: str, owner_id: str) -> list[NoteShare]:
        self._require_owner(note_id, owner_id)
        with self._uow_factory() as uow:
            return uow.notes.list_shares(note_id)

    def share(
        self,
        note_id: str,
        owner_id: str,
        *,
        identifier: str,
        can_read: bool = True,
        can_write: bool = False,
    ) -> NoteShare:
        note = self._require_owner(note_id, owner_id)
        can_write = bool(can_write)
        can_read = bool(can_read) or can_write
        if not can_read:
            raise NoteAccessError("Elige al menos lectura o escritura.", 400)
        if self._auth is None:
            raise NoteAccessError("No se pudo buscar al usuario.", 500)
        try:
            recipient = self._auth.find_recipient(identifier)
        except AuthError as exc:
            raise NoteAccessError(exc.message, exc.status_code) from exc
        if recipient.id == owner_id:
            raise NoteAccessError("No puedes compartir la nota contigo mismo.", 400)
        if note.user_id and recipient.id == note.user_id:
            raise NoteAccessError("Esa persona ya es dueña de la nota.", 400)
        with self._uow_factory() as uow:
            existing = uow.notes.share_for(note_id, recipient.id)
            if existing is not None:
                existing.can_read = can_read
                existing.can_write = can_write
                existing.name = recipient.name
                existing.email = recipient.email
                saved = uow.notes.update_share(existing)
                uow.commit()
                return saved
            share = NoteShare(
                note_id=note_id,
                user_id=recipient.id,
                can_read=can_read,
                can_write=can_write,
                name=recipient.name,
                email=recipient.email,
            )
            saved = uow.notes.add_share(share)
            uow.commit()
            return saved

    def update_share(
        self,
        note_id: str,
        share_id: str,
        owner_id: str,
        *,
        can_read: bool | None = None,
        can_write: bool | None = None,
    ) -> NoteShare:
        self._require_owner(note_id, owner_id)
        with self._uow_factory() as uow:
            share = uow.notes.get_share(share_id)
            if share is None or share.note_id != note_id:
                raise NoteAccessError("No está compartida con esa persona.", 404)
            if can_read is not None:
                share.can_read = can_read
            if can_write is not None:
                share.can_write = can_write
            share.can_read = bool(share.can_read) or bool(share.can_write)
            if not share.can_read:
                raise NoteAccessError("Elige al menos lectura o escritura.", 400)
            saved = uow.notes.update_share(share)
            uow.commit()
            return saved

    def unshare(self, note_id: str, share_id: str, owner_id: str) -> None:
        self._require_owner(note_id, owner_id)
        with self._uow_factory() as uow:
            share = uow.notes.get_share(share_id)
            if share is None or share.note_id != note_id:
                raise NoteAccessError("No está compartida con esa persona.", 404)
            uow.notes.delete_share(share_id)
            uow.commit()

    def _require_owner(self, note_id: str, owner_id: str) -> Note:
        with self._uow_factory() as uow:
            note = uow.notes.get(note_id)
        if note is None:
            raise NoteAccessError("Note not found", 404)
        if note.user_id and note.user_id != owner_id:
            raise NoteAccessError("Solo quien creó la nota puede compartirla.", 403)
        return note

    def _users_by_ids(self, user_ids: list[str]) -> dict:
        if not user_ids or self._auth is None:
            return {}
        return self._auth.users_by_ids(user_ids)
