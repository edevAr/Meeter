from __future__ import annotations

from dataclasses import dataclass, field

from app.domain.models.action_item import ActionItem
from app.domain.models.analysis import MeetingAnalysis
from app.domain.models.note import Note
from app.domain.models.recording import Recording
from app.domain.models.task import Task
from app.domain.models.transcript import Transcript


@dataclass
class SearchResults:
    recordings: list[Recording] = field(default_factory=list)
    transcripts: list[Transcript] = field(default_factory=list)
    analyses: list[MeetingAnalysis] = field(default_factory=list)
    action_items: list[ActionItem] = field(default_factory=list)
    notes: list[Note] = field(default_factory=list)
    tasks: list[Task] = field(default_factory=list)

    @property
    def total(self) -> int:
        return (
            len(self.recordings)
            + len(self.transcripts)
            + len(self.analyses)
            + len(self.action_items)
            + len(self.notes)
            + len(self.tasks)
        )


class SearchService:
    def __init__(self, uow_factory) -> None:
        self._uow_factory = uow_factory

    def search(self, query: str) -> SearchResults:
        needle = (query or "").strip()
        if len(needle) < 2:
            return SearchResults()
        with self._uow_factory() as uow:
            return SearchResults(
                recordings=uow.recordings.search_by_title(needle),
                transcripts=uow.transcripts.search_text(needle),
                analyses=uow.analyses.search_topics(needle),
                action_items=uow.action_items.search(needle),
                notes=uow.notes.search(needle),
                tasks=uow.tasks.search(needle),
            )
