from __future__ import annotations

from pathlib import Path

import pytest

from app.application.services.export_service import ExportError, ExportService
from app.config.settings import Settings
from app.domain.interfaces.export import ExportFormat
from app.domain.models.action_item import ActionItem
from app.domain.models.analysis import Decision, KeyTopic, MeetingAnalysis
from app.domain.models.recording import Recording
from app.domain.models.transcript import Transcript, TranscriptSegment


def _sample(tmp_path: Path) -> tuple[Recording, Transcript, MeetingAnalysis, list[ActionItem]]:
    recording = Recording(title="Migration review", file_path=str(tmp_path / "a.wav"))
    transcript = Transcript(
        recording_id=recording.id,
        text="We will migrate this weekend.",
        language="en",
        segments=[
            TranscriptSegment(
                transcript_id="t",
                start_time=1.0,
                end_time=4.0,
                speaker="Speaker 1",
                text="We will migrate this weekend.",
            )
        ],
    )
    transcript.segments[0].transcript_id = transcript.id
    analysis = MeetingAnalysis(
        recording_id=recording.id,
        transcript_id=transcript.id,
        summary="Migrate over the weekend.",
        key_topics=[KeyTopic(analysis_id="a", topic="Migration", sequence=0)],
        decisions=[Decision(analysis_id="a", text="Migrate this weekend.", sequence=0)],
        participants=["Alex"],
    )
    analysis.key_topics[0].analysis_id = analysis.id
    analysis.decisions[0].analysis_id = analysis.id
    items = [
        ActionItem(
            analysis_id=analysis.id,
            recording_id=recording.id,
            recording_title=recording.title,
            task="Prepare script",
        )
    ]
    return recording, transcript, analysis, items


def test_export_transcript_formats(settings: Settings, tmp_path: Path) -> None:
    service = ExportService(settings)
    recording, transcript, *_ = _sample(tmp_path)
    txt = service.export_transcript(recording, transcript, ExportFormat.TXT)
    md = service.export_transcript(recording, transcript, ExportFormat.MARKDOWN)
    js = service.export_transcript(recording, transcript, ExportFormat.JSON)
    assert txt.read_text(encoding="utf-8").startswith("Migration review")
    assert "Speaker 1" in md.read_text(encoding="utf-8")
    assert "transcript" in js.read_text(encoding="utf-8")


def test_export_analysis_formats(settings: Settings, tmp_path: Path) -> None:
    service = ExportService(settings)
    recording, _transcript, analysis, items = _sample(tmp_path)
    md = service.export_analysis(recording, analysis, items, ExportFormat.MARKDOWN)
    js = service.export_analysis(recording, analysis, items, ExportFormat.JSON)
    body = md.read_text(encoding="utf-8")
    assert "Prepare script" in body
    assert "Migrate over the weekend" in body
    assert "action_items" in js.read_text(encoding="utf-8")


def test_pdf_not_implemented(settings: Settings, tmp_path: Path) -> None:
    service = ExportService(settings)
    recording, transcript, *_ = _sample(tmp_path)
    with pytest.raises(ExportError):
        service.export_transcript(recording, transcript, ExportFormat.PDF)
