from __future__ import annotations

import asyncio
import logging
import os
import threading
import time
from pathlib import Path

from app.domain.interfaces.transcription import (
    TranscriptResult,
    TranscriptSegmentResult,
    TranscriptionProvider,
)
from app.infrastructure.security.files import FileValidationError, validate_audio_path

logger = logging.getLogger(__name__)

# CTranslate2 / PyTorch are not safe for overlapping transcribe() calls.
# Two live sockets (or stop + worker) previously stacked inferences and a 2.8s
# clip took ~7 minutes on CPU.
_INFER_LOCK = threading.Lock()


class TranscriptionError(RuntimeError):
    pass


class CloudTranscriptionDisabledError(TranscriptionError):
    pass


def _cpu_threads() -> int:
    return max(1, min(4, os.cpu_count() or 4))


def faster_whisper_decode_options(*, live: bool, language: str | None) -> dict:
    """Decode settings. Live must stay faster than realtime on CPU."""
    lang = None if not language or language in {"auto", "", "None"} else language
    if live:
        return {
            "language": lang,
            "beam_size": 1,
            "best_of": 1,
            "temperature": 0.0,
            "condition_on_previous_text": False,
            "vad_filter": True,
            "vad_parameters": {"min_silence_duration_ms": 400, "speech_pad_ms": 160},
            "without_timestamps": True,
            "word_timestamps": False,
        }
    return {
        "language": lang,
        "beam_size": 5,
        "best_of": 5,
        "condition_on_previous_text": True,
        "vad_filter": True,
        "word_timestamps": False,
    }


def openai_whisper_decode_options(*, live: bool, language: str | None) -> dict:
    kwargs: dict = {"fp16": False, "verbose": False}
    if language and language not in {"auto", "", "None"}:
        kwargs["language"] = language
    if live:
        kwargs.update(
            {
                "beam_size": 1,
                "best_of": 1,
                "temperature": 0.0,
                "condition_on_previous_text": False,
                "without_timestamps": True,
            }
        )
    return kwargs


def pcm16_to_float32(pcm16: bytes):
    import numpy as np

    samples = np.frombuffer(pcm16, dtype=np.int16)
    if samples.size == 0:
        return np.zeros(0, dtype=np.float32)
    return np.ascontiguousarray(samples.astype(np.float32) / 32768.0)


def _segments_from_whisper(raw_segments: list) -> list[TranscriptSegmentResult]:
    segments: list[TranscriptSegmentResult] = []
    for item in raw_segments:
        text = str(item.get("text", "")).strip()
        if not text:
            continue
        segments.append(
            TranscriptSegmentResult(
                start_time=float(item.get("start", 0.0)),
                end_time=float(item.get("end", 0.0)),
                text=text,
                speaker=None,
            )
        )
    return segments


class WhisperTranscriptionProvider(TranscriptionProvider):
    """Local Whisper. Audio never leaves the machine."""

    name = "whisper"
    is_cloud = False

    def __init__(self, model_name: str = "base", max_bytes: int = 500 * 1024 * 1024) -> None:
        self.model_name = model_name
        self.max_bytes = max_bytes
        self._model = None

    def warmup(self) -> None:
        self._transcribe_audio(pcm16_to_float32(b"\x00\x00" * 16000), language="es", live=True)

    def _load(self):
        if self._model is None:
            try:
                import whisper
            except ImportError as exc:
                raise TranscriptionError(
                    "Local Whisper is not installed. Run: pip install openai-whisper"
                ) from exc
            logger.info("Whisper model loading started name=%s", self.model_name)
            self._model = whisper.load_model(self.model_name)
            logger.info("Whisper model loading completed name=%s", self.model_name)
        return self._model

    def _transcribe_audio(self, audio, language: str | None, live: bool) -> TranscriptResult:
        waited = time.monotonic()
        with _INFER_LOCK:
            lock_wait = time.monotonic() - waited
            if lock_wait > 0.05:
                logger.info("Whisper lock wait_s=%.2f live=%s", lock_wait, live)
            model = self._load()
            kwargs = openai_whisper_decode_options(live=live, language=language)
            started = time.monotonic()
            result = model.transcribe(audio, **kwargs)
            elapsed = time.monotonic() - started
            raw_segments = result.get("segments") or []
            text = str(result.get("text", "")).strip()
            detected = result.get("language")
            logger.info(
                "Whisper done live=%s elapsed_s=%.2f chars=%s",
                live,
                elapsed,
                len(text),
            )
            return TranscriptResult(
                text=text,
                language=str(detected) if detected else language,
                segments=_segments_from_whisper(raw_segments),
                provider=self.name,
                model_name=self.model_name,
            )

    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
        progress_callback: callable | None = None,
        live: bool = False,
    ) -> TranscriptResult:
        path = validate_audio_path(Path(audio_path), self.max_bytes, must_exist=True)
        if progress_callback:
            progress_callback(5)
        logger.info("Transcription started live=%s", live)
        try:
            result = await asyncio.to_thread(self._transcribe_audio, str(path), language, live)
        except FileValidationError:
            raise
        except TranscriptionError:
            raise
        except Exception as exc:
            raise TranscriptionError("Transcription failed") from exc
        logger.info("Transcription completed live=%s", live)
        if progress_callback:
            progress_callback(100)
        return result

    async def transcribe_pcm(
        self,
        pcm16: bytes,
        sample_rate: int = 16000,
        language: str | None = None,
        live: bool = False,
    ) -> TranscriptResult:
        del sample_rate
        audio = pcm16_to_float32(pcm16)
        logger.info("Transcription started live=%s pcm_s=%.2f", live, len(audio) / 16000)
        try:
            result = await asyncio.to_thread(self._transcribe_audio, audio, language, live)
        except Exception as exc:
            raise TranscriptionError("Transcription failed") from exc
        logger.info("Transcription completed live=%s", live)
        return result


class FasterWhisperTranscriptionProvider(TranscriptionProvider):
    name = "faster-whisper"
    is_cloud = False

    def __init__(self, model_name: str = "base", max_bytes: int = 500 * 1024 * 1024) -> None:
        self.model_name = model_name
        self.max_bytes = max_bytes
        self._model = None

    def warmup(self) -> None:
        self._transcribe_audio(pcm16_to_float32(b"\x00\x00" * 16000), language="es", live=True)

    def _load(self):
        if self._model is None:
            try:
                from faster_whisper import WhisperModel
            except ImportError as exc:
                raise TranscriptionError(
                    "faster-whisper is not installed. Run: pip install faster-whisper"
                ) from exc
            threads = _cpu_threads()
            logger.info(
                "faster-whisper model loading started name=%s device=cpu compute=int8 cpu_threads=%s",
                self.model_name,
                threads,
            )
            self._model = WhisperModel(
                self.model_name,
                device="cpu",
                compute_type="int8",
                cpu_threads=threads,
                num_workers=1,
            )
            logger.info("faster-whisper model loading completed name=%s", self.model_name)
        return self._model

    def _transcribe_audio(self, audio, language: str | None, live: bool) -> TranscriptResult:
        waited = time.monotonic()
        with _INFER_LOCK:
            lock_wait = time.monotonic() - waited
            if lock_wait > 0.05:
                logger.info("faster-whisper lock wait_s=%.2f live=%s", lock_wait, live)
            model = self._load()
            options = faster_whisper_decode_options(live=live, language=language)
            started = time.monotonic()
            segments_iter, info = model.transcribe(audio, **options)
            segments: list[TranscriptSegmentResult] = []
            parts: list[str] = []
            for seg in segments_iter:
                text = (seg.text or "").strip()
                if not text:
                    continue
                parts.append(text)
                segments.append(
                    TranscriptSegmentResult(
                        start_time=float(seg.start),
                        end_time=float(seg.end),
                        text=text,
                    )
                )
            elapsed = time.monotonic() - started
            detected = getattr(info, "language", language)
            joined = " ".join(parts).strip()
            logger.info(
                "faster-whisper done live=%s elapsed_s=%.2f chars=%s",
                live,
                elapsed,
                len(joined),
            )
            return TranscriptResult(
                text=joined,
                language=str(detected) if detected else language,
                segments=segments,
                provider=self.name,
                model_name=self.model_name,
            )

    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
        progress_callback: callable | None = None,
        live: bool = False,
    ) -> TranscriptResult:
        path = validate_audio_path(Path(audio_path), self.max_bytes, must_exist=True)
        if progress_callback:
            progress_callback(5)
        logger.info("Transcription started live=%s", live)
        result = await asyncio.to_thread(self._transcribe_audio, str(path), language, live)
        logger.info("Transcription completed live=%s", live)
        if progress_callback:
            progress_callback(100)
        return result

    async def transcribe_pcm(
        self,
        pcm16: bytes,
        sample_rate: int = 16000,
        language: str | None = None,
        live: bool = False,
    ) -> TranscriptResult:
        del sample_rate
        audio = pcm16_to_float32(pcm16)
        logger.info("Transcription started live=%s pcm_s=%.2f", live, len(audio) / 16000)
        result = await asyncio.to_thread(self._transcribe_audio, audio, language, live)
        logger.info("Transcription completed live=%s", live)
        return result


class OpenAITranscriptionProvider(TranscriptionProvider):
    """Cloud Speech-to-Text. Disabled unless ALLOW_CLOUD_TRANSCRIPTION=true."""

    name = "openai"
    is_cloud = True

    def __init__(
        self,
        api_key: str,
        model_name: str = "whisper-1",
        allow_cloud: bool = False,
        max_bytes: int = 500 * 1024 * 1024,
        base_url: str | None = None,
    ) -> None:
        self.api_key = api_key
        self.model_name = model_name
        self.allow_cloud = allow_cloud
        self.max_bytes = max_bytes
        self.base_url = base_url or None

    async def transcribe(
        self,
        audio_path: str,
        language: str | None = None,
        progress_callback: callable | None = None,
        live: bool = False,
    ) -> TranscriptResult:
        del live
        if not self.allow_cloud:
            raise CloudTranscriptionDisabledError(
                "Cloud transcription is disabled. Enable ALLOW_CLOUD_TRANSCRIPTION to send audio to OpenAI."
            )
        if not self.api_key:
            raise TranscriptionError("AI_API_KEY is required for OpenAI transcription")
        path = validate_audio_path(Path(audio_path), self.max_bytes, must_exist=True)
        if progress_callback:
            progress_callback(10)
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:
            raise TranscriptionError("openai package is required") from exc

        client_kwargs: dict = {"api_key": self.api_key}
        if self.base_url:
            client_kwargs["base_url"] = self.base_url
        client = AsyncOpenAI(**client_kwargs)
        kwargs: dict = {"model": self.model_name, "response_format": "verbose_json"}
        if language and language not in {"auto", ""}:
            kwargs["language"] = language
        logger.info("Transcription started")
        with path.open("rb") as handle:
            response = await client.audio.transcriptions.create(file=handle, **kwargs)
        if progress_callback:
            progress_callback(90)
        text = getattr(response, "text", "") or ""
        detected = getattr(response, "language", language)
        raw_segments = getattr(response, "segments", None) or []
        segments: list[TranscriptSegmentResult] = []
        for item in raw_segments:
            if hasattr(item, "model_dump"):
                data = item.model_dump()
            elif isinstance(item, dict):
                data = item
            else:
                data = {
                    "start": getattr(item, "start", 0.0),
                    "end": getattr(item, "end", 0.0),
                    "text": getattr(item, "text", ""),
                }
            segment_text = str(data.get("text", "")).strip()
            if segment_text:
                segments.append(
                    TranscriptSegmentResult(
                        start_time=float(data.get("start", 0.0)),
                        end_time=float(data.get("end", 0.0)),
                        text=segment_text,
                    )
                )
        logger.info("Transcription completed")
        if progress_callback:
            progress_callback(100)
        return TranscriptResult(
            text=text.strip(),
            language=str(detected) if detected else None,
            segments=segments,
            provider=self.name,
            model_name=self.model_name,
        )
