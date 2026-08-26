from __future__ import annotations

import asyncio
import json

from fastapi import APIRouter, Depends, HTTPException, Query
from fastapi.responses import StreamingResponse

from app.api.deps import get_container, get_current_user
from app.api.schemas import (
    CallNoteCreate,
    NoteCreate,
    NoteOut,
    NotePatch,
    NoteShareIn,
    NoteShareOut,
    NoteSharePatch,
    NoteSyncIn,
    NoteSyncOut,
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


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data, default=str)}\n\n"


def _broadcast(
    container: AppContainer,
    op: str,
    note: Note | None,
    *,
    note_id: str | None = None,
    audience: list[str] | None = None,
) -> None:
    nid = note_id or (note.id if note else "")
    users = audience if audience is not None else container.notes.audience_ids(nid)
    payload: dict = {"op": op, "id": nid, "deleted": op == "delete"}
    if note is not None and op != "delete":
        data = _out(note).model_dump(mode="json")
        payload["note"] = data
        payload["updated_at"] = data.get("updated_at")
    container.note_events.publish(users, payload)


def _raise_access(exc: NoteAccessError) -> None:
    raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc


@router.get("", response_model=list[NoteOut])
def list_notes(
    archived: bool = Query(default=False),
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> list[NoteOut]:
    return [_out(note) for note in container.notes.list_for_board(archived=archived, user_id=user.id)]


@router.post("/sync", response_model=NoteSyncOut)
def sync_notes(
    payload: NoteSyncIn,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> NoteSyncOut:
    def emit(op: str, note: Note | None, note_id: str, audience: list[str]) -> None:
        _broadcast(container, op, note, note_id=note_id, audience=audience)

    notes = container.notes.sync(user.id, payload.notes, emit=emit)
    return NoteSyncOut(notes=[_out(note) for note in notes])


@router.get("/events")
async def note_events(
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> StreamingResponse:
    queue = container.note_events.subscribe(user.id)

    async def stream():
        try:
            yield _sse("ready", {"ok": True})
            while True:
                try:
                    event = await asyncio.wait_for(queue.get(), timeout=20)
                except asyncio.TimeoutError:
                    yield _sse("ping", {})
                    continue
                yield _sse("note", event)
        finally:
            container.note_events.unsubscribe(user.id, queue)

    return StreamingResponse(
        stream(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache, no-transform",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


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
    _broadcast(container, "upsert", note)
    return _out(note)


@router.post("", response_model=NoteOut, status_code=201)
def create_note(
    payload: NoteCreate,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> NoteOut:
    note = container.notes.create(
        note_id=payload.id,
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
    _broadcast(container, "upsert", note)
    return _out(note)


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
        share = container.notes.share(
            note_id,
            user.id,
            identifier=payload.identifier,
            can_read=payload.can_read,
            can_write=payload.can_write,
        )
        note = container.notes.get(note_id, user_id=user.id)
        if note is not None:
            _broadcast(container, "upsert", note, audience=container.notes.audience_ids(note_id))
        return _share_out(share)
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
    recipient_id = None
    try:
        people = container.notes.list_shares(note_id, user.id)
        recipient_id = next((share.user_id for share in people if share.id == share_id), None)
        container.notes.unshare(note_id, share_id, user.id)
    except NoteAccessError as exc:
        _raise_access(exc)
    if recipient_id:
        _broadcast(container, "delete", None, note_id=note_id, audience=[recipient_id])
    note = container.notes.get(note_id, user_id=user.id)
    if note is not None:
        _broadcast(container, "upsert", note)
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
    saved = container.notes.update(note)
    _broadcast(container, "upsert", saved)
    return _out(saved)


@router.delete("/{note_id}")
def delete_note(
    note_id: str,
    container: AppContainer = Depends(get_container),
    user: User = Depends(get_current_user),
) -> dict[str, str]:
    audience = container.notes.audience_ids(note_id)
    try:
        container.notes.delete(note_id, user_id=user.id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Note not found") from exc
    _broadcast(container, "delete", None, note_id=note_id, audience=audience)
    return {"detail": "deleted"}
