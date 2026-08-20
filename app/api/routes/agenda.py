from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_container
from app.api.schemas import AgendaItemOut, AgendaOut
from app.container import AppContainer

router = APIRouter(prefix="/api/agenda", tags=["agenda"])


@router.get("", response_model=AgendaOut)
def get_agenda(
    period: str = Query(default="day", pattern="^(day|week|month)$"),
    container: AppContainer = Depends(get_container),
) -> AgendaOut:
    items = container.agenda.pending(period)
    return AgendaOut(
        period=period,
        items=[AgendaItemOut.model_validate(item.__dict__) for item in items],
    )
