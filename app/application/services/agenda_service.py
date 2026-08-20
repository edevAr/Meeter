from __future__ import annotations

from dataclasses import dataclass
from datetime import date

from app.application.services.dates import in_range, parse_due_date, range_bounds
from app.domain.models.enums import ActionItemPriority, ActionItemStatus


@dataclass
class AgendaItem:
    id: str
    kind: str
    title: str
    details: str
    due_date: str | None
    priority: ActionItemPriority
    status: ActionItemStatus
    source: str
    recording_id: str | None = None
    note_id: str | None = None
    overdue: bool = False


class AgendaService:
    def __init__(self, uow_factory) -> None:
        self._uow_factory = uow_factory

    def pending(self, period: str = "day", today: date | None = None) -> list[AgendaItem]:
        today = today or date.today()
        start, end = range_bounds(period, today)
        include_undated = period == "day"
        include_overdue = period == "day"
        items: list[AgendaItem] = []
        with self._uow_factory() as uow:
            for task in uow.tasks.list():
                due = parse_due_date(task.due_date)
                if not in_range(
                    due, start, end, include_undated=include_undated, include_overdue=include_overdue
                ):
                    continue
                items.append(
                    AgendaItem(
                        id=task.id,
                        kind="task",
                        title=task.title,
                        details=task.details,
                        due_date=task.due_date,
                        priority=task.priority,
                        status=task.status,
                        source=task.source,
                        recording_id=task.recording_id,
                        note_id=task.note_id,
                        overdue=due is not None and due < today and task.status != ActionItemStatus.COMPLETED,
                    )
                )
            for action in uow.action_items.list():
                due = parse_due_date(action.due_date)
                if not in_range(
                    due, start, end, include_undated=include_undated, include_overdue=include_overdue
                ):
                    continue
                items.append(
                    AgendaItem(
                        id=action.id,
                        kind="action_item",
                        title=action.task,
                        details=action.recording_title or "",
                        due_date=action.due_date,
                        priority=action.priority,
                        status=action.status,
                        source="call",
                        recording_id=action.recording_id,
                        overdue=due is not None and due < today and action.status != ActionItemStatus.COMPLETED,
                    )
                )
        order = {ActionItemStatus.PENDING: 0, ActionItemStatus.IN_PROGRESS: 1, ActionItemStatus.COMPLETED: 2}
        items.sort(
            key=lambda item: (
                order.get(item.status, 9),
                0 if item.overdue else 1,
                item.due_date or "9999-99-99",
                item.title.lower(),
            )
        )
        return items
