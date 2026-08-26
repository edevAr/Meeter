from __future__ import annotations

from datetime import datetime, timezone

from app.application.services.auth_service import AuthError, AuthService
from app.domain.models.note import Note, NoteShare


def _stamp(value: datetime | None) -> datetime | None:
    if value is None:
        return None
    if value.tzinfo is None:
        return value.replace(tzinfo=timezone.utc)
    return value


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
        updated_at: datetime | None = None,
        reminder_at: datetime | None = None,
        alarm_tone: str = "classic",
        reminder_silenced: bool = False,
        archived: bool = False,
        user_id: str | None = None,
        note_id: str | None = None,
    ) -> Note:
        created = created_at or datetime.now(timezone.utc)
        touched = updated_at or datetime.now(timezone.utc)
        payload = dict(
            title=title.strip(),
            body=body.strip(),
            color=color or "yellow",
            pinned=pinned,
            archived=bool(archived),
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
            created_at=created,
            updated_at=touched,
        )
        if note_id:
            payload["id"] = note_id.strip()
        note = Note(**payload)
        with self._uow_factory() as uow:
            uow.notes.add(note)
            uow.commit()
            return note

    def update(self, note: Note, touch: bool = True) -> Note:
        if touch:
            note.updated_at = datetime.now(timezone.utc)
        with self._uow_factory() as uow:
            saved = uow.notes.update(note)
            uow.commit()
            return saved

    def audience_ids(self, note_id: str) -> list[str]:
        with self._uow_factory() as uow:
            note = uow.notes.get(note_id)
            if note is None:
                return []
            ids: list[str] = []
            if note.user_id:
                ids.append(note.user_id)
            ids.extend(share.user_id for share in uow.notes.list_shares(note_id))
        return list(dict.fromkeys(ids))

    def sync(self, user_id: str, items: list, emit=None) -> list[Note]:
        for item in items:
            note_id = (getattr(item, "id", None) or "").strip()
            if not note_id:
                continue
            if getattr(item, "deleted", False):
                audience = self.audience_ids(note_id)
                try:
                    self.delete(note_id, user_id)
                    if emit:
                        emit("delete", None, note_id, audience)
                except KeyError:
                    pass
                continue
            existing = self.get(note_id, user_id=user_id)
            incoming_at = _stamp(getattr(item, "updated_at", None))
            if existing is None:
                owned = self.get(note_id)
                if owned is not None:
                    continue
                self.create(
                    note_id=note_id,
                    title=item.title,
                    body=item.body,
                    color=item.color,
                    recording_id=item.recording_id,
                    pinned=item.pinned,
                    priority=item.priority,
                    pos_x=item.pos_x,
                    pos_y=item.pos_y,
                    rotation=item.rotation,
                    width=item.width,
                    height=item.height,
                    created_at=_stamp(item.created_at) or incoming_at,
                    updated_at=incoming_at,
                    reminder_at=item.reminder_at,
                    alarm_tone=item.alarm_tone,
                    reminder_silenced=item.reminder_silenced,
                    archived=bool(item.archived),
                    user_id=user_id,
                )
                saved = self.get(note_id, user_id=user_id)
                if emit and saved is not None:
                    emit("upsert", saved, note_id, self.audience_ids(note_id))
                continue
            access = self.access_of(note_id, user_id)
            if access == "read":
                continue
            if _stamp(existing.updated_at) and incoming_at and incoming_at < _stamp(existing.updated_at):
                continue
            existing.title = item.title
            existing.body = item.body
            existing.color = item.color or existing.color
            existing.priority = max(1, min(5, int(item.priority or existing.priority)))
            existing.pos_x = item.pos_x
            existing.pos_y = item.pos_y
            existing.rotation = item.rotation
            existing.width = item.width
            existing.height = item.height
            existing.reminder_at = item.reminder_at
            existing.alarm_tone = item.alarm_tone or existing.alarm_tone
            existing.reminder_silenced = bool(item.reminder_silenced)
            existing.recording_id = item.recording_id or existing.recording_id
            if getattr(item, "created_at", None):
                existing.created_at = _stamp(item.created_at) or existing.created_at
            if access == "owner":
                existing.pinned = bool(item.pinned)
                existing.archived = bool(item.archived)
            existing.updated_at = incoming_at or datetime.now(timezone.utc)
            saved = self.update(existing, touch=False)
            if emit:
                emit("upsert", saved, note_id, self.audience_ids(note_id))
        return self.list_for_board(archived=False, user_id=user_id) + self.list_for_board(
            archived=True, user_id=user_id
        )

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
