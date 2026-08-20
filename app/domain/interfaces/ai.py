from __future__ import annotations

from abc import ABC, abstractmethod

from app.domain.models.analysis import MeetingAnalysisResult


class AIProvider(ABC):
    """LLM backend for structured meeting analysis."""

    name: str
    is_cloud: bool = True

    @abstractmethod
    async def analyze(self, transcript: str, title: str | None = None) -> MeetingAnalysisResult:
        raise NotImplementedError
