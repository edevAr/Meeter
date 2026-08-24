from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_container, get_current_user
from app.api.schemas import (
    CallNoteCreate,
    NoteCreate,
    NoteOut,
    NotePatch,
    NoteShareIn,
    NoteShareOut,
    NoteSharePatch,
)
from app.application.services.note_service import NoteAccessError
from app.container import AppContainer
from app.domain.models.note import Note, NoteShare, utcnow
from app.domain.models.user import User
from app.infrastructure.ai.call_note import format_call_note
from app.infrastructure.ai.local_summarizer import LocalCallSummarizer

router = APIRouter(prefix="/api/notes", tags=["notes"])


def _out(note: Note) -> NoteOut:
    return NoteOut.model_validate(note.model_dump())


def _share_out(share: NoteShare) -> NoteShareOut:
    return NoteShareOut.model_validate(share.model_dump())


def _raise_access(exc: NoteAccessError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("", response_model=list[NoteOut])
def list_notes(
    archived: bool = Query(default=False),
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> list[NoteOut]:
    return [_out(note) for note in container.notes.list_for_board(archived=archived, user_id=user.id)]


@router.post("/from-call", response_model=NoteOut, status_code=201)
async def note_from_call(
    payload: CallNoteCreate,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> NoteOut:
    transcript = (payload.transcript or "").strip()
    try:
        analysis = await container.ai.analyze(transcript, title=payload.title or "Llamada")
    except Exception:
        analysis = await LocalCallSummarizer().analyze(transcript, title=payload.title)
    title, body = format_call_note(analysis, transcript)
    note = container.notes.create(
        title=title,
        body=body,
        color=payload.color or "amber",
        recording_id=payload.recording_id,
        priority=1,
        pos_x=payload.pos_x,
        pos_y=payload.pos_y,
        rotation=-2.2,
        width=280,
        height=460,
        created_at=payload.created_at,
        user_id=user.id,
    )
    return _out(note)


@router.post("", response_model=NoteOut, status_code=201)
def create_note(
    payload: NoteCreate,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> NoteOut:
    return _out(
        container.notes.create(
            title=payload.title,
            body=payload.body,
            color=payload.color,
            recording_id=payload.recording_id,
            pinned=payload.pinned,
            priority=payload.priority,
            pos_x=payload.pos_x,
            pos_y=payload.pos_y,
            rotation=payload.rotation,
            width=payload.width,
            height=payload.height,
            created_at=payload.created_at,
            reminder_at=payload.reminder_at,
            alarm_tone=payload.alarm_tone,
            user_id=user.id,
        )
    )


@router.get("/{note_id}/shares", response_model=list[NoteShareOut])
def list_shares(
    note_id: str,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> list[NoteShareOut]:
    try:
        return [_share_out(share) for share in container.notes.list_shares(note_id, user.id)]
    except NoteAccessError as exc:
        _raise_access(exc)
        raise


@router.post("/{note_id}/shares", response_model=NoteShareOut, status_code=201)
def share_note(
    note_id: str,
    payload: NoteShareIn,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> NoteShareOut:
    try:
        return _share_out(
            container.notes.share(
                note_id,
                user.id,
                identifier=payload.identifier,
                can_read=payload.can_read,
                can_write=payload.can_write,
            )
        )
    except NoteAccessError as exc:
        _raise_access(exc)
        raise


@router.patch("/{note_id}/shares/{share_id}", response_model=NoteShareOut)
def patch_share(
    note_id: str,
    share_id: str,
    payload: NoteSharePatch,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> NoteShareOut:
    try:
        return _share_out(
            container.notes.update_share(
                note_id,
                share_id,
                user.id,
                can_read=payload.can_read,
                can_write=payload.can_write,
            )
        )
    except NoteAccessError as exc:
        _raise_access(exc)
        raise


@router.delete("/{note_id}/shares/{share_id}")
def unshare_note(
    note_id: str,
    share_id: str,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        container.notes.unshare(note_id, share_id, user.id)
    except NoteAccessError as exc:
        _raise_access(exc)
    return {"detail": "unshared"}


@router.patch("/{note_id}", response_model=NoteOut)
def patch_note(
    note_id: str,
    payload: NotePatch,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> NoteOut:
    access = container.notes.access_of(note_id, user.id)
    if access is None:
        raise HTTPException(status_code=404, detail="Note not found")
    if access == "read":
        raise HTTPException(status_code=403, detail="Esta nota es de solo lectura.")
    note = container.notes.get(note_id, user_id=user.id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    data = payload.model_dump(exclude_unset=True)
    if "priority" in data and data["priority"] is not None:
        data["priority"] = max(1, min(5, int(data["priority"])))
    if access != "owner":
        data.pop("archived", None)
        data.pop("pinned", None)
    if "archived" in data and data["archived"] is not None and bool(data["archived"]) != bool(note.archived):
        note.updated_at = utcnow()
    for key, value in data.items():
        setattr(note, key, value)
    return _out(container.notes.update(note))


@router.delete("/{note_id}")
def delete_note(
    note_id: str,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    try:
        container.notes.delete(note_id, user_id=user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Note not found") from exc
    return {"detail": "deleted"}
