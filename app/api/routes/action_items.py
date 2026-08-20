from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_container
from app.api.schemas import ActionItemOut, ActionItemPatch
from app.container import AppContainer
from app.domain.models.action_item import ActionItem
from app.domain.models.enums import ActionItemPriority, ActionItemStatus

router = APIRouter(prefix="/api/action-items", tags=["action-items"])


def _out(item: ActionItem) -> ActionItemOut:
    return ActionItemOut.model_validate(item.model_dump())


@router.get("", response_model=list[ActionItemOut])
def list_action_items(
    status: ActionItemStatus | None = Query(default=None),
    priority: ActionItemPriority | None = Query(default=None),
    high_priority: bool = Query(default=False),
    container: AppContainer = Depends(get_container),
) -> list[ActionItemOut]:
    return [
        _out(item)
        for item in container.action_items.list(
            status=status,
            priority=priority,
            high_priority_only=high_priority,
        )
    ]


@router.patch("/{item_id}", response_model=ActionItemOut)
def patch_action_item(
    item_id: str,
    payload: ActionItemPatch,
    container: AppContainer = Depends(get_container),
) -> ActionItemOut:
    item = container.action_items.get(item_id)
    if item is None:
        raise HTTPException(status_code=404, detail="Action item not found")
    if payload.status is not None:
        item.status = payload.status
    if payload.owner is not None:
        item.owner = payload.owner or None
    if payload.due_date is not None:
        item.due_date = payload.due_date or None
    if payload.priority is not None:
        item.priority = payload.priority
    if payload.task is not None:
        item.task = payload.task
    return _out(container.action_items.update(item))
