from __future__ import annotations

import asyncio
import logging

from app.config.settings import Settings
from app.domain.interfaces.diarization import SpeakerDiarizationProvider, SpeakerTurn
from app.infrastructure.ai.diarization import NullSpeakerDiarizationProvider
from app.infrastructure.diarization.clustering import ClusteringDiarizationProvider
from app.infrastructure.transcription.alignment import remap_speaker_labels

logger = logging.getLogger(__name__)


class PyannoteDiarizationProvider(SpeakerDiarizationProvider):
    name = "pyannote"

    def __init__(self, token: str, model: str) -> None:
        self.token = token
        self.model = model
        self._pipeline = None

    def _load(self):
        if self._pipeline is None:
            from pyannote.audio import Pipeline

            kwargs = {"token": self.token} if self.token else {}
            try:
                self._pipeline = Pipeline.from_pretrained(self.model, **kwargs)
            except TypeError:
                self._pipeline = Pipeline.from_pretrained(self.model, use_auth_token=self.token or None)
        return self._pipeline

    async def identify_speakers(self, audio_path: str) -> list[SpeakerTurn]:
        return await asyncio.to_thread(self._identify, audio_path)

    def _identify(self, audio_path: str) -> list[SpeakerTurn]:
        pipeline = self._load()
        diarization = pipeline(audio_path)
        turns: list[SpeakerTurn] = []
        for turn, _, speaker in diarization.itertracks(yield_label=True):
            turns.append(
                SpeakerTurn(start_time=float(turn.start), end_time=float(turn.end), speaker=str(speaker))
            )
        labeled = remap_speaker_labels(turns)
        logger.info("DIARIZATION pyannote speakers=%s turns=%s", len({t.speaker for t in labeled}), len(labeled))
        return labeled


class FallbackDiarizationProvider(SpeakerDiarizationProvider):
    def __init__(self, primary: SpeakerDiarizationProvider, fallback: SpeakerDiarizationProvider) -> None:
        self.primary = primary
        self.fallback = fallback
        self.name = primary.name

    async def identify_speakers(self, audio_path: str) -> list[SpeakerTurn]:
        try:
            turns = await self.primary.identify_speakers(audio_path)
            if turns:
                return turns
        except Exception:
            logger.info("Speaker diarization primary failed, using %s", self.fallback.name)
        return await self.fallback.identify_speakers(audio_path)


def create_diarization_provider(settings: Settings) -> SpeakerDiarizationProvider:
    name = (settings.diarization_provider or "clustering").strip().lower()
    clustering = ClusteringDiarizationProvider()
    if name in {"none", "off", "null"}:
        return NullSpeakerDiarizationProvider()
    if name == "clustering":
        return clustering
    if name in {"pyannote", "auto"}:
        token = (settings.hf_token or "").strip()
        try:
            import pyannote.audio  # noqa: F401
        except ImportError:
            if name == "pyannote":
                logger.info("pyannote.audio is not installed; using clustering diarization")
            return clustering
        if name == "pyannote" and not token:
            logger.info("HF_TOKEN missing; using clustering diarization")
            return clustering
        pyannote = PyannoteDiarizationProvider(token, settings.pyannote_model)
        return FallbackDiarizationProvider(pyannote, clustering)
    return clustering
