from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException, Query

from app.api.deps import get_container
from app.api.schemas import TaskCreate, TaskOut, TaskPatch
from app.container import AppContainer
from app.domain.models.task import Task

router = APIRouter(prefix="/api/tasks", tags=["tasks"])


def _out(task: Task) -> TaskOut:
    return TaskOut.model_validate(task.model_dump())


@router.get("", response_model=list[TaskOut])
def list_tasks(
    status: str | None = Query(default=None),
    container: AppContainer = Depends(get_container),
) -> list[TaskOut]:
    parsed = None
    if status:
        from app.domain.models.enums import ActionItemStatus

        parsed = ActionItemStatus(status)
    return [_out(task) for task in container.tasks.list(status=parsed)]


@router.post("", response_model=TaskOut, status_code=201)
def create_task(payload: TaskCreate, container: AppContainer = Depends(get_container)) -> TaskOut:
    if not payload.title.strip():
        raise HTTPException(status_code=400, detail="A title is required")
    return _out(
        container.tasks.create(
            title=payload.title,
            details=payload.details,
            due_date=payload.due_date,
            priority=payload.priority,
            source=payload.source,
            note_id=payload.note_id,
            recording_id=payload.recording_id,
        )
    )


@router.patch("/{task_id}", response_model=TaskOut)
def patch_task(
    task_id: str,
    payload: TaskPatch,
    container: AppContainer = Depends(get_container),
) -> TaskOut:
    task = container.tasks.get(task_id)
    if task is None:
        raise HTTPException(status_code=404, detail="Task not found")
    data = payload.model_dump(exclude_unset=True)
    if "due_date" in data and data["due_date"] == "":
        data["due_date"] = None
    for key, value in data.items():
        setattr(task, key, value)
    return _out(container.tasks.update(task))


@router.delete("/{task_id}")
def delete_task(task_id: str, container: AppContainer = Depends(get_container)) -> dict[str, str]:
    try:
        container.tasks.delete(task_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Task not found") from exc
    return {"detail": "deleted"}
