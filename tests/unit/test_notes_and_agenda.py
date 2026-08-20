from __future__ import annotations

import pytest
from datetime import date, datetime, timezone

from app.application.services.agenda_service import AgendaService
from app.application.services.note_service import NoteService
from app.application.services.task_service import TaskService
from app.domain.models.enums import ActionItemPriority, ActionItemStatus


@pytest.mark.asyncio
async def test_local_summarizer_extracts_points() -> None:
    from app.infrastructure.ai.call_note import format_call_note
    from app.infrastructure.ai.local_summarizer import LocalCallSummarizer

    result = await LocalCallSummarizer().analyze(
        "Hablamos del presupuesto con el cliente. Acordamos enviar la propuesta el lunes. "
        "Hay que llamar a Ana para confirmar la fecha."
    )
    assert result.summary
    title, body = format_call_note(
        result,
        "Hablamos del presupuesto con el cliente. Acordamos enviar la propuesta el lunes. "
        "Hay que llamar a Ana para confirmar la fecha.",
    )
    assert title
    assert "Puntos clave" in body or "Pendientes" in body or "Decisiones" in body
    assert "Transcripción" in body
    assert "llamar a Ana" in body


def test_merge_live_transcript_keeps_new_words() -> None:
    from app.application.services.live_transcript_service import merge_transcript

    first = merge_transcript("", "Hola mundo")
    second = merge_transcript(first, "pato amarillo")
    third = merge_transcript(second, "Hola mundo")
    fourth = merge_transcript(third, "hola mundo pato amarillo")
    fifth = merge_transcript(fourth, "hola mundo hola mundo pato amarillo")
    windowed = merge_transcript("hola mundo", "mundo pato amarillo")
    assert merge_transcript("", "hola mundo hola mundo") == "hola mundo"
    assert merge_transcript("hola mundo", "hola mundo hola mundo") == "hola mundo"
    assert merge_transcript("hola mundo", "hola mundo") == "hola mundo"
    assert second == "hola mundo pato amarillo"
    assert third == "hola mundo pato amarillo"
    assert fourth == "hola mundo pato amarillo"
    assert fifth == "hola mundo pato amarillo"
    assert windowed == "hola mundo pato amarillo"
    kept = merge_transcript("hola mundo pato amarillo y luego más", "pato amarillo")
    assert kept == "hola mundo pato amarillo y luego más"
    spoken = merge_transcript("", "hola mundo")
    spoken = merge_transcript(spoken, "hola mundo como estas")
    spoken = merge_transcript(spoken, "hola mundo hola mundo como estas")
    spoken = merge_transcript(spoken, "hola mundo como estas esto es un ejemplo")
    spoken = merge_transcript(
        spoken,
        "hola mundo hola mundo como estas como estas esto es un ejemplo esto es un ejemplo",
    )
    assert spoken == "hola mundo como estas esto es un ejemplo"


def test_notes_create_and_update(uow_factory) -> None:
    service = NoteService(uow_factory)
    note = service.create(title="Idea", body="Llamar a Ana", color="yellow", pos_x=120, pos_y=80, priority=1)
    assert note.id
    listed = service.list()
    assert listed[0].body == "Llamar a Ana"
    assert listed[0].priority == 1
    assert listed[0].pos_x == 120
    note.pinned = True
    updated = service.update(note)
    assert updated.pinned is True
    stamp = datetime(2099, 4, 1, 9, 30, tzinfo=timezone.utc)
    note.reminder_at = stamp
    reminded = service.update(note)
    assert reminded.reminder_at == stamp
    note.reminder_silenced = True
    silenced = service.update(note)
    assert silenced.reminder_silenced is True
    assert silenced.reminder_at == stamp
    service.delete(note.id)
    assert service.list() == []


def test_notes_create_for_future_day(uow_factory) -> None:
    service = NoteService(uow_factory)
    stamp = datetime(2099, 3, 1, 12, 0, tzinfo=timezone.utc)
    note = service.create(title="Futuro", created_at=stamp)
    assert note.created_at == stamp
    service.delete(note.id)


def test_tasks_and_agenda_day(uow_factory) -> None:
    tasks = TaskService(uow_factory)
    today = date.today().isoformat()
    tasks.create(title="Enviar propuesta", due_date=today, priority=ActionItemPriority.HIGH)
    tasks.create(title="Leer informe", due_date="2099-01-01")
    pending = AgendaService(uow_factory).pending("day")
    titles = [item.title for item in pending]
    assert "Enviar propuesta" in titles
    assert "Leer informe" not in titles
    item = next(entry for entry in pending if entry.title == "Enviar propuesta")
    saved = tasks.get(item.id)
    assert saved is not None
    saved.status = ActionItemStatus.COMPLETED
    tasks.update(saved)
    completed = AgendaService(uow_factory).pending("day")
    done = next(entry for entry in completed if entry.title == "Enviar propuesta")
    assert done.status == ActionItemStatus.COMPLETED
