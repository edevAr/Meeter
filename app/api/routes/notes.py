from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_container
from app.api.schemas import CallNoteCreate, NoteCreate, NoteOut, NotePatch
from app.container import AppContainer
from app.domain.models.note import Note, utcnow
from app.infrastructure.ai.call_note import format_call_note
from app.infrastructure.ai.local_summarizer import LocalCallSummarizer

router = APIRouter(prefix="/api/notes", tags=["notes"])


def _out(note: Note) -> NoteOut:
    return NoteOut.model_validate(note.model_dump())


@router.get("", response_model=list[NoteOut])
def list_notes(
    archived: bool = Query(default=False),
    container: AppContainer = Depends(get_container),
) -> list[NoteOut]:
    return [_out(note) for note in container.notes.list(archived=archived)]


@router.post("/from-call", response_model=NoteOut, status_code=201)
async def note_from_call(
    payload: CallNoteCreate,
    container: AppContainer = Depends(get_container),
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
    )
    return _out(note)


@router.post("", response_model=NoteOut, status_code=201)
def create_note(payload: NoteCreate, container: AppContainer = Depends(get_container)) -> NoteOut:
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
        )
    )


@router.patch("/{note_id}", response_model=NoteOut)
def patch_note(
    note_id: str,
    payload: NotePatch,
    container: AppContainer = Depends(get_container),
) -> NoteOut:
    note = container.notes.get(note_id)
    if note is None:
        raise HTTPException(status_code=404, detail="Note not found")
    data = payload.model_dump(exclude_unset=True)
    if "priority" in data and data["priority"] is not None:
        data["priority"] = max(1, min(5, int(data["priority"])))
    if "archived" in data and data["archived"] is not None and bool(data["archived"]) != bool(note.archived):
        note.updated_at = utcnow()
    for key, value in data.items():
        setattr(note, key, value)
    return _out(container.notes.update(note))


@router.delete("/{note_id}")
def delete_note(note_id: str, container: AppContainer = Depends(get_container)) -> dict[str, str]:
    try:
        container.notes.delete(note_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Note not found") from exc
    return {"detail": "deleted"}
