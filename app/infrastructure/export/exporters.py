from __future__ import annotations

import json
from pathlib import Path

from app.domain.interfaces.export import ExportFormat, Exporter
from app.domain.models.action_item import ActionItem
from app.domain.models.analysis import MeetingAnalysis
from app.domain.models.recording import Recording
from app.domain.models.transcript import Transcript


def _header(recording: Recording) -> str:
    created = recording.created_at.strftime("%Y-%m-%d %H:%M UTC")
    return f"# {recording.title}\n\n- Date: {created}\n- Duration: {recording.duration_seconds:.0f}s\n"


class TranscriptTxtExporter(Exporter):
    format = ExportFormat.TXT

    def export_transcript(self, recording: Recording, transcript: Transcript, destination: Path) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        lines = [recording.title, "", transcript.text]
        destination.write_text("\n".join(lines), encoding="utf-8")
        return destination

    def export_analysis(self, recording: Recording, analysis: MeetingAnalysis, destination: Path) -> Path:
        raise NotImplementedError("TXT analysis export is not used; use Markdown or JSON")


class MarkdownExporter(Exporter):
    format = ExportFormat.MARKDOWN

    def export_transcript(self, recording: Recording, transcript: Transcript, destination: Path) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        parts = [_header(recording), "## Transcript\n"]
        if transcript.segments:
            for segment in transcript.segments:
                speaker = segment.speaker or "Speaker"
                timestamp = _fmt_ts(segment.start_time)
                parts.append(f"**{speaker}** `{timestamp}`\n\n{segment.text}\n")
        else:
            parts.append(transcript.text + "\n")
        destination.write_text("\n".join(parts), encoding="utf-8")
        return destination

    def export_analysis(
        self,
        recording: Recording,
        analysis: MeetingAnalysis,
        destination: Path,
        action_items: list[ActionItem] | None = None,
    ) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        parts = [_header(recording), "## Summary\n", analysis.summary + "\n", "## Key Topics\n"]
        if analysis.key_topics:
            parts.extend(f"- {topic.topic}" for topic in analysis.key_topics)
        else:
            parts.append("- None identified")
        parts.append("\n## Decisions\n")
        if analysis.decisions:
            parts.extend(f"- {decision.text}" for decision in analysis.decisions)
        else:
            parts.append("- None identified")
        parts.append("\n## Participants\n")
        if analysis.participants:
            parts.extend(f"- {name}" for name in analysis.participants)
        else:
            parts.append("- Not specified")
        items = action_items or []
        parts.append("\n## Action Items\n")
        if items:
            for item in items:
                parts.append(
                    f"- **{item.task}** — Owner: {item.display_owner()}; "
                    f"Due: {item.display_due()}; Priority: {item.priority.value}; "
                    f"Status: {item.status.value}"
                )
        else:
            parts.append("- None identified")
        destination.write_text("\n".join(parts) + "\n", encoding="utf-8")
        return destination


class JsonExporter(Exporter):
    format = ExportFormat.JSON

    def export_transcript(self, recording: Recording, transcript: Transcript, destination: Path) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "recording": recording.model_dump(mode="json"),
            "transcript": transcript.model_dump(mode="json"),
        }
        destination.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
        return destination

    def export_analysis(
        self,
        recording: Recording,
        analysis: MeetingAnalysis,
        destination: Path,
        action_items: list[ActionItem] | None = None,
    ) -> Path:
        destination.parent.mkdir(parents=True, exist_ok=True)
        payload = {
            "recording": recording.model_dump(mode="json"),
            "analysis": analysis.model_dump(mode="json"),
            "action_items": [item.model_dump(mode="json") for item in (action_items or [])],
        }
        destination.write_text(json.dumps(payload, indent=2, ensure_ascii=True), encoding="utf-8")
        return destination


def _fmt_ts(seconds: float) -> str:
    total = int(max(0, seconds))
    minutes, secs = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:02d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"
