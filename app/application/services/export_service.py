from __future__ import annotations

from pathlib import Path

from app.config.settings import Settings
from app.domain.interfaces.export import ExportFormat
from app.domain.models.action_item import ActionItem
from app.domain.models.analysis import MeetingAnalysis
from app.domain.models.recording import Recording
from app.domain.models.transcript import Transcript
from app.infrastructure.export.exporters import JsonExporter, MarkdownExporter, TranscriptTxtExporter
from app.infrastructure.security.files import FileValidationError, safe_join, sanitize_filename


class ExportError(RuntimeError):
    pass


class ExportService:
    def __init__(self, settings: Settings) -> None:
        self._settings = settings
        self._txt = TranscriptTxtExporter()
        self._md = MarkdownExporter()
        self._json = JsonExporter()

    def export_transcript(
        self,
        recording: Recording,
        transcript: Transcript,
        fmt: ExportFormat,
        destination: Path | None = None,
    ) -> Path:
        if fmt == ExportFormat.PDF:
            raise ExportError("PDF export is not available yet")
        path = destination or self._default_path(recording, "transcript", fmt)
        if fmt == ExportFormat.TXT:
            return self._txt.export_transcript(recording, transcript, path)
        if fmt == ExportFormat.MARKDOWN:
            return self._md.export_transcript(recording, transcript, path)
        if fmt == ExportFormat.JSON:
            return self._json.export_transcript(recording, transcript, path)
        raise ExportError(f"Unsupported transcript format: {fmt}")

    def export_analysis(
        self,
        recording: Recording,
        analysis: MeetingAnalysis,
        action_items: list[ActionItem],
        fmt: ExportFormat,
        destination: Path | None = None,
    ) -> Path:
        if fmt == ExportFormat.PDF:
            raise ExportError("PDF export is not available yet")
        if fmt == ExportFormat.TXT:
            raise ExportError("Analysis export supports Markdown and JSON")
        path = destination or self._default_path(recording, "analysis", fmt)
        if fmt == ExportFormat.MARKDOWN:
            return self._md.export_analysis(recording, analysis, path, action_items)
        if fmt == ExportFormat.JSON:
            return self._json.export_analysis(recording, analysis, path, action_items)
        raise ExportError(f"Unsupported analysis format: {fmt}")

    def _default_path(self, recording: Recording, kind: str, fmt: ExportFormat) -> Path:
        name = f"{sanitize_filename(recording.title)}-{kind}.{fmt.value}"
        try:
            return safe_join(self._settings.exports_path, name)
        except FileValidationError as exc:
            raise ExportError("Invalid export path") from exc
