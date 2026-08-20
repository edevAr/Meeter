from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field


@dataclass
class TranscriptSegmentResult:
    start_time: float
    end_time: float
    text: str
    speaker: str | None = None


@dataclass
class TranscriptResult:
    text: str
    language: str | None
    segments: list[TranscriptSegmentResult] = field(default_factory=list)
    provider: str = "whisper"
    model_name: str | None = None


class TranscriptionProvider(ABC):
    """Speech-to-text backend. Swap Whisper / OpenAI / Azure without touching use cases."""

    name: str
    is_cloud: bool = False

    @abstractmethod
    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
        progress_callback: callable | None = None,
    ) -> TranscriptResult:
        raise NotImplementedError
