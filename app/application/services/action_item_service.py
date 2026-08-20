from __future__ import annotations

from datetime import datetime, timezone

from app.domain.models.action_item import ActionItem
from app.domain.models.enums import ActionItemPriority, ActionItemStatus


class ActionItemService:
    def __init__(self, uow_factory) -> None:
        self._uow_factory = uow_factory

    def list(
        self,
        status: ActionItemStatus | None = None,
        priority: ActionItemPriority | None = None,
        high_priority_only: bool = False,
    ) -> list[ActionItem]:
        if high_priority_only:
            priority = ActionItemPriority.HIGH
        with self._uow_factory() as uow:
            return uow.action_items.list(status=status, priority=priority)

    def get(self, item_id: str) -> ActionItem | None:
        with self._uow_factory() as uow:
            return uow.action_items.get(item_id)

    def update_status(self, item_id: str, status: ActionItemStatus) -> ActionItem:
        with self._uow_factory() as uow:
            item = uow.action_items.get(item_id)
            if item is None:
                raise KeyError(item_id)
            item.status = status
            item.updated_at = datetime.now(timezone.utc)
            uow.action_items.update(item)
            uow.commit()
            return item

    def update(self, item: ActionItem) -> ActionItem:
        item.updated_at = datetime.now(timezone.utc)
        with self._uow_factory() as uow:
            saved = uow.action_items.update(item)
            uow.commit()
            return saved

    def for_recording(self, recording_id: str) -> list[ActionItem]:
        with self._uow_factory() as uow:
            return [item for item in uow.action_items.list() if item.recording_id == recording_id]
