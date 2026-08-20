from __future__ import annotations

from app.domain.interfaces.diarization import SpeakerDiarizationProvider, SpeakerTurn


class NullSpeakerDiarizationProvider(SpeakerDiarizationProvider):
    """Placeholder so speaker labels can be added later without schema changes."""

    name = "none"

    async def identify_speakers(self, audio_path: str) -> list[SpeakerTurn]:
        return []
