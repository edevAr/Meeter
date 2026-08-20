from __future__ import annotations

from abc import ABC, abstractmethod
from enum import StrEnum
from pathlib import Path

from app.domain.models.analysis import MeetingAnalysis
from app.domain.models.recording import Recording
from app.domain.models.transcript import Transcript


class ExportFormat(StrEnum):
    TXT = "txt"
    MARKDOWN = "md"
    JSON = "json"
    PDF = "pdf"


class Exporter(ABC):
    """Format-specific exporter. PDF can be added later without changing callers."""

    format: ExportFormat

    @abstractmethod
    def export_transcript(
        self,
        recording: Recording,
        transcript: Transcript,
        destination: Path,
    ) -> Path:
        raise NotImplementedError

    @abstractmethod
    def export_analysis(
        self,
        recording: Recording,
        analysis: MeetingAnalysis,
        destination: Path,
    ) -> Path:
        raise NotImplementedError
