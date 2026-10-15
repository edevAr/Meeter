from __future__ import annotations

import asyncio
import logging
import time
from pathlib import Path
from uuid import uuid4

from app.domain.interfaces.diarization import SpeakerDiarizationProvider, SpeakerTurn
from app.domain.interfaces.transcription import TranscriptResult, TranscriptionProvider
from app.domain.models.enums import RecordingStatus
from app.domain.models.transcript import Transcript, TranscriptSegment
from app.infrastructure.security.files import validate_audio_path
from app.infrastructure.transcription.alignment import (
    format_speaker_transcript,
    remap_speaker_labels,
    speaker_for_span,
)
from app.infrastructure.transcription.whisper_provider import TranscriptionError, decode_audio_file

logger = logging.getLogger(__name__)


class TranscriptionService:
    def __init__(
        self,
        uow_factory,
        provider: TranscriptionProvider,
        diarization: SpeakerDiarizationProvider,
        max_bytes: int,
    ) -> None:
        self._uow_factory = uow_factory
        self._provider = provider
        self._diarization = diarization
        self._max_bytes = max_bytes

    @property
    def provider(self) -> TranscriptionProvider:
        return self._provider

    async def transcribe(
        self,
        recording_id: str,
        language: str | None = None,
        progress_callback: callable | None = None,
    ) -> Transcript:
        with self._uow_factory() as uow:
            recording = uow.recordings.get(recording_id)
            if recording is None:
                raise KeyError(recording_id)
            if not recording.status.can_transcribe:
                raise TranscriptionError("Recording is not ready to transcribe")
            path = recording.file_path
            logger.info(
                "EXTRACT pedido recording_id=%s title=%r duration=%.1fs language=%s file=%s",
                recording_id,
                recording.title,
                recording.duration_seconds,
                language or "auto",
                Path(path).name,
            )
            recording.status = RecordingStatus.TRANSCRIBING
            recording.error_message = None
            recording.touch()
            uow.recordings.update(recording)
            uow.commit()

        validate_audio_path(Path(path), self._max_bytes, must_exist=True)
        pipeline_started = time.monotonic()

        try:
            if progress_callback:
                progress_callback(4)
            audio = await _decode_once(path)
            if progress_callback:
                progress_callback(10)
            speaker_turns = await self._diarize(path, audio)
            if progress_callback:
                progress_callback(22)
            result = await self._whisper(path, audio, language, progress_callback)
        except Exception as exc:
            message = str(exc).strip() or "Transcription failed"
            if isinstance(exc, TranscriptionError):
                logger.warning("EXTRACT error recording_id=%s detail=%s", recording_id, message)
            else:
                logger.exception("EXTRACT crashed recording_id=%s", recording_id)
            with self._uow_factory() as uow:
                recording = uow.recordings.get(recording_id)
                if recording is not None:
                    recording.status = RecordingStatus.FAILED
                    recording.error_message = message[:400]
                    recording.touch()
                    uow.recordings.update(recording)
                    uow.commit()
            if isinstance(exc, TranscriptionError):
                raise
            raise TranscriptionError("Transcription failed") from exc

        transcript_id = str(uuid4())
        segments: list[TranscriptSegment] = []
        for index, seg in enumerate(result.segments):
            speaker = seg.speaker or speaker_for_span(speaker_turns, seg.start_time, seg.end_time)
            segments.append(
                TranscriptSegment(
                    transcript_id=transcript_id,
                    start_time=seg.start_time,
                    end_time=seg.end_time,
                    speaker=speaker,
                    text=seg.text,
                    sequence=index,
                )
            )
        labeled = format_speaker_transcript(segments, fallback=result.text)
        transcript = Transcript(
            id=transcript_id,
            recording_id=recording_id,
            text=labeled,
            language=result.language or language,
            provider=result.provider,
            model_name=result.model_name,
            segments=segments,
        )
        with self._uow_factory() as uow:
            uow.transcripts.add(transcript)
            recording = uow.recordings.get(recording_id)
            if recording is not None:
                recording.status = RecordingStatus.TRANSCRIBED
                recording.language = transcript.language
                recording.error_message = None
                recording.touch()
                uow.recordings.update(recording)
            uow.commit()
        logger.info(
            "EXTRACT listo recording_id=%s chars=%s language=%s segments=%s speakers=%s elapsed=%.1fs",
            recording_id,
            len(labeled or ""),
            transcript.language,
            len(segments),
            len({item.speaker for item in segments if item.speaker}),
            time.monotonic() - pipeline_started,
        )
        return transcript

    async def _diarize(self, path: str, audio) -> list[SpeakerTurn]:
        started = time.monotonic()
        try:
            identify_samples = getattr(self._diarization, "identify_from_samples", None)
            if callable(identify_samples) and _is_samples(audio):
                turns = await identify_samples(audio)
            else:
                turns = await self._diarization.identify_speakers(path)
            labeled = remap_speaker_labels(turns)
            logger.info(
                "PIPELINE diarize=%.1fs speakers=%s turns=%s",
                time.monotonic() - started,
                len({turn.speaker for turn in labeled}),
                len(labeled),
            )
            return labeled
        except Exception:
            logger.exception("DIARIZATION failed path=%s — continuing without speakers", Path(path).name)
            return []

    async def _whisper(
        self,
        path: str,
        audio,
        language: str | None,
        progress_callback,
    ) -> TranscriptResult:
        started = time.monotonic()

        def mapped_progress(pct: int) -> None:
            if progress_callback:
                progress_callback(max(22, min(100, 22 + int(int(pct) * 0.78))))

        transcribe_samples = getattr(self._provider, "transcribe_samples", None)
        if callable(transcribe_samples) and _is_samples(audio):
            result = await transcribe_samples(audio, language=language, progress_callback=mapped_progress)
        else:
            result = await self._provider.transcribe(
                path,
                language=language,
                progress_callback=mapped_progress,
            )
        logger.info(
            "PIPELINE whisper=%.1fs chars=%s segments=%s",
            time.monotonic() - started,
            len(result.text or ""),
            len(result.segments),
        )
        return result

    def get_for_recording(self, recording_id: str) -> Transcript | None:
        with self._uow_factory() as uow:
            return uow.transcripts.get_by_recording(recording_id)


async def _decode_once(path: str):
    started = time.monotonic()
    audio = await asyncio.to_thread(decode_audio_file, path)
    logger.info("PIPELINE decode=%.1fs", time.monotonic() - started)
    return audio


def _is_samples(audio) -> bool:
    try:
        import numpy as np
    except ImportError:
        return False
    return isinstance(audio, np.ndarray) and audio.size > 0
