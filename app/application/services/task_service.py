from __future__ import annotations

from datetime import datetime, timezone

from app.domain.models.enums import ActionItemPriority, ActionItemStatus
from app.domain.models.task import Task


class TaskService:
    def __init__(self, uow_factory) -> None:
        self._uow_factory = uow_factory

    def list(
        self,
        status: ActionItemStatus | None = None,
        priority: ActionItemPriority | None = None,
    ) -> list[Task]:
        with self._uow_factory() as uow:
            return uow.tasks.list(status=status, priority=priority)

    def get(self, task_id: str) -> Task | None:
        with self._uow_factory() as uow:
            return uow.tasks.get(task_id)

    def create(
        self,
        *,
        title: str,
        details: str = "",
        due_date: str | None = None,
        priority: ActionItemPriority = ActionItemPriority.MEDIUM,
        source: str = "manual",
        note_id: str | None = None,
        recording_id: str | None = None,
    ) -> Task:
        task = Task(
            title=title.strip(),
            details=details.strip(),
            due_date=due_date or None,
            priority=priority,
            source=source,
            note_id=note_id,
            recording_id=recording_id,
        )
        with self._uow_factory() as uow:
            uow.tasks.add(task)
            uow.commit()
            return task

    def update(self, task: Task) -> Task:
        task.updated_at = datetime.now(timezone.utc)
        with self._uow_factory() as uow:
            saved = uow.tasks.update(task)
            uow.commit()
            return saved

    def delete(self, task_id: str) -> None:
        with self._uow_factory() as uow:
            if uow.tasks.get(task_id) is None:
                raise KeyError(task_id)
            uow.tasks.delete(task_id)
            uow.commit()
