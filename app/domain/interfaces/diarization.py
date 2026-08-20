from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass


@dataclass
class SpeakerTurn:
    start_time: float
    end_time: float
    speaker: str


class SpeakerDiarizationProvider(ABC):
    """Optional speaker identification. First release may skip runtime diarization.

    The transcript segment model already stores `speaker`, so a future
    pyannote / Azure diarization provider can populate it without schema changes.
    """

    name: str

    @abstractmethod
    async def identify_speakers(self, audio_path: str) -> list[SpeakerTurn]:
        raise NotImplementedError
