from __future__ import annotations

from app.domain.interfaces.diarization import SpeakerTurn
from app.domain.models.transcript import TranscriptSegment
from app.infrastructure.transcription.alignment import (
    format_speaker_transcript,
    format_timestamp,
    remap_speaker_labels,
    speaker_for_span,
)


def test_speaker_for_span_uses_overlap() -> None:
    turns = [
        SpeakerTurn(0.0, 2.0, "A"),
        SpeakerTurn(2.0, 5.0, "B"),
    ]
    labeled = remap_speaker_labels(turns)
    assert speaker_for_span(labeled, 0.2, 1.4) == "SPEAKER_01"
    assert speaker_for_span(labeled, 2.1, 3.8) == "SPEAKER_02"
    assert speaker_for_span(labeled, 1.6, 2.4) in {"SPEAKER_01", "SPEAKER_02"}


def test_format_speaker_transcript_merges_turns() -> None:
    segments = [
        TranscriptSegment(transcript_id="t", start_time=0.2, end_time=1.1, speaker="SPEAKER_01", text="Hola", sequence=0),
        TranscriptSegment(transcript_id="t", start_time=1.1, end_time=2.0, speaker="SPEAKER_01", text="buenas.", sequence=1),
        TranscriptSegment(transcript_id="t", start_time=2.1, end_time=3.4, speaker="SPEAKER_02", text="Creo que sí.", sequence=2),
    ]
    text = format_speaker_transcript(segments)
    assert "SPEAKER_01 [00:00]: Hola buenas." in text
    assert "SPEAKER_02 [00:02]: Creo que sí." in text
    assert format_timestamp(75) == "01:15"
