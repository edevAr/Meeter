from __future__ import annotations

from enum import StrEnum


class RecordingStatus(StrEnum):
    """Lifecycle of a recording through capture, transcription and analysis.

    COMPLETED in the product UI maps to ANALYZED (pipeline finished).
    RECORDED is the state after the file has been saved and is ready to transcribe.
    """

    RECORDING = "recording"
    PAUSED = "paused"
    RECORDED = "recorded"
    TRANSCRIBING = "transcribing"
    TRANSCRIBED = "transcribed"
    ANALYZING = "analyzing"
    ANALYZED = "analyzed"
    FAILED = "failed"

    @property
    def label(self) -> str:
        return {
            RecordingStatus.RECORDING: "Recording",
            RecordingStatus.PAUSED: "Paused",
            RecordingStatus.RECORDED: "Recorded",
            RecordingStatus.TRANSCRIBING: "Transcribing",
            RecordingStatus.TRANSCRIBED: "Transcribed",
            RecordingStatus.ANALYZING: "Analyzing",
            RecordingStatus.ANALYZED: "Completed",
            RecordingStatus.FAILED: "Failed",
        }[self]

    @property
    def is_terminal(self) -> bool:
        return self in {RecordingStatus.ANALYZED, RecordingStatus.FAILED}

    @property
    def can_transcribe(self) -> bool:
        return self in {
            RecordingStatus.RECORDED,
            RecordingStatus.TRANSCRIBING,
            RecordingStatus.TRANSCRIBED,
            RecordingStatus.ANALYZED,
            RecordingStatus.FAILED,
        }

    @property
    def can_analyze(self) -> bool:
        return self in {RecordingStatus.TRANSCRIBED, RecordingStatus.ANALYZED}

    @property
    def can_play(self) -> bool:
        return self not in {RecordingStatus.RECORDING, RecordingStatus.PAUSED}


class AudioSourceType(StrEnum):
    MICROPHONE = "microphone"
    DEFAULT_INPUT = "default_input"
    SYSTEM = "system"


class ActionItemPriority(StrEnum):
    LOW = "low"
    MEDIUM = "medium"
    HIGH = "high"


class ActionItemStatus(StrEnum):
    PENDING = "pending"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"


class RecorderState(StrEnum):
    IDLE = "idle"
    RECORDING = "recording"
    PAUSED = "paused"
