from __future__ import annotations

from abc import ABC, abstractmethod
from typing import Sequence

from app.domain.models.action_item import ActionItem
from app.domain.models.analysis import MeetingAnalysis
from app.domain.models.enums import ActionItemPriority, ActionItemStatus
from app.domain.models.note import Note
from app.domain.models.recording import Recording
from app.domain.models.task import Task
from app.domain.models.transcript import Transcript


class RecordingRepository(ABC):
    @abstractmethod
    def add(self, recording: Recording) -> Recording:
        raise NotImplementedError

    @abstractmethod
    def get(self, recording_id: str) -> Recording | None:
        raise NotImplementedError

    @abstractmethod
    def list(self, limit: int = 200, offset: int = 0) -> list[Recording]:
        raise NotImplementedError

    @abstractmethod
    def update(self, recording: Recording) -> Recording:
        raise NotImplementedError

    @abstractmethod
    def delete(self, recording_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def search_by_title(self, query: str) -> list[Recording]:
        raise NotImplementedError

    @abstractmethod
    def counts(self) -> dict[str, int]:
        raise NotImplementedError


class TranscriptRepository(ABC):
    @abstractmethod
    def add(self, transcript: Transcript) -> Transcript:
        raise NotImplementedError

    @abstractmethod
    def get_by_recording(self, recording_id: str) -> Transcript | None:
        raise NotImplementedError

    @abstractmethod
    def delete_by_recording(self, recording_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def search_text(self, query: str) -> list[Transcript]:
        raise NotImplementedError


class AnalysisRepository(ABC):
    @abstractmethod
    def add(self, analysis: MeetingAnalysis) -> MeetingAnalysis:
        raise NotImplementedError

    @abstractmethod
    def get_by_recording(self, recording_id: str) -> MeetingAnalysis | None:
        raise NotImplementedError

    @abstractmethod
    def delete_by_recording(self, recording_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def search_topics(self, query: str) -> list[MeetingAnalysis]:
        raise NotImplementedError


class ActionItemRepository(ABC):
    @abstractmethod
    def add_many(self, items: Sequence[ActionItem]) -> list[ActionItem]:
        raise NotImplementedError

    @abstractmethod
    def list(
        self,
        status: ActionItemStatus | None = None,
        priority: ActionItemPriority | None = None,
    ) -> list[ActionItem]:
        raise NotImplementedError

    @abstractmethod
    def get(self, item_id: str) -> ActionItem | None:
        raise NotImplementedError

    @abstractmethod
    def update(self, item: ActionItem) -> ActionItem:
        raise NotImplementedError

    @abstractmethod
    def delete_by_recording(self, recording_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def search(self, query: str) -> list[ActionItem]:
        raise NotImplementedError


class NoteRepository(ABC):
    @abstractmethod
    def add(self, note: Note) -> Note:
        raise NotImplementedError

    @abstractmethod
    def get(self, note_id: str) -> Note | None:
        raise NotImplementedError

    @abstractmethod
    def list(self, archived: bool = False) -> list[Note]:
        raise NotImplementedError

    @abstractmethod
    def update(self, note: Note) -> Note:
        raise NotImplementedError

    @abstractmethod
    def delete(self, note_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def search(self, query: str) -> list[Note]:
        raise NotImplementedError


class TaskRepository(ABC):
    @abstractmethod
    def add(self, task: Task) -> Task:
        raise NotImplementedError

    @abstractmethod
    def get(self, task_id: str) -> Task | None:
        raise NotImplementedError

    @abstractmethod
    def list(
        self,
        status: ActionItemStatus | None = None,
        priority: ActionItemPriority | None = None,
    ) -> list[Task]:
        raise NotImplementedError

    @abstractmethod
    def update(self, task: Task) -> Task:
        raise NotImplementedError

    @abstractmethod
    def delete(self, task_id: str) -> None:
        raise NotImplementedError

    @abstractmethod
    def search(self, query: str) -> list[Task]:
        raise NotImplementedError


class UnitOfWork(ABC):
    recordings: RecordingRepository
    transcripts: TranscriptRepository
    analyses: AnalysisRepository
    action_items: ActionItemRepository
    notes: NoteRepository
    tasks: TaskRepository

    @abstractmethod
    def __enter__(self) -> UnitOfWork:
        raise NotImplementedError

    @abstractmethod
    def __exit__(self, exc_type, exc, tb) -> None:
        raise NotImplementedError

    @abstractmethod
    def commit(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def rollback(self) -> None:
        raise NotImplementedError
