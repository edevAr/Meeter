from __future__ import annotations

from dataclasses import dataclass

from app.domain.models.recording import Recording


@dataclass
class DashboardSnapshot:
    recordings: int
    transcribed: int
    analyzed: int
    recent: list[Recording]


class DashboardService:
    def __init__(self, uow_factory) -> None:
        self._uow_factory = uow_factory

    def snapshot(self) -> DashboardSnapshot:
        with self._uow_factory() as uow:
            counts = uow.recordings.counts()
            recent = uow.recordings.list(limit=8)
        return DashboardSnapshot(
            recordings=counts["recordings"],
            transcribed=counts["transcribed"],
            analyzed=counts["analyzed"],
            recent=recent,
        )
