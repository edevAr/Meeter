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
# clip took ~7 minutes on CPU. File extract with beam_size=5 then hung the
# container at 100% CPU for an hour on a 2-minute webm.
_INFER_LOCK = threading.Lock()
_LOCK_WAIT_S = 90.0
_FFMPEG_TIMEOUT_S = 40
_MAX_FILE_SECONDS = 8 * 60
_SAMPLE_RATE = 16000
_CHUNK_SECONDS = 30
_PROGRESS_BEAT_S = 15.0


class TranscriptionError(RuntimeError):
    pass


class CloudTranscriptionDisabledError(TranscriptionError):
    pass


def _cpu_threads() -> int:
    return max(1, min(4, os.cpu_count() or 4))


def faster_whisper_decode_options(*, live: bool, language: str | None) -> dict:
    """Decode settings. CPU Docker cannot run beam search without stalling the API."""
    lang = None if not language or language in {"auto", "", "None"} else language
    return {
        "language": lang,
        "beam_size": 1,
        "best_of": 1,
        "temperature": 0.0,
        "condition_on_previous_text": False,
        # Silero VAD on Chrome MediaRecorder webm was splitting speech into
        # hundreds of tiny windows; each one ran a full Whisper pass and the
        # extract lock never came back.
        "vad_filter": False,
        # Timestamp tokens on CPU stall a 43s clip for 7+ minutes. Segment
        # start/end still come from the 30s decode windows.
        "without_timestamps": True,
        "word_timestamps": False,
        "chunk_length": _CHUNK_SECONDS,
        "max_new_tokens": 224,
    }


def openai_whisper_decode_options(*, live: bool, language: str | None) -> dict:
    kwargs: dict = {
        "fp16": False,
        "verbose": False,
        "beam_size": 1,
        "best_of": 1,
        "temperature": 0.0,
        "condition_on_previous_text": False,
        "without_timestamps": True,
    }
    if language and language not in {"auto", "", "None"}:
        kwargs["language"] = language
    return kwargs


def _audio_seconds(audio) -> float:
    try:
        import numpy as np
    except ImportError:
        return 0.0
    if isinstance(audio, np.ndarray) and audio.size:
        return float(audio.size) / _SAMPLE_RATE
    return 0.0


def _preview(text: str, limit: int = 48) -> str:
    compact = " ".join((text or "").split())
    if len(compact) <= limit:
        return compact
    return compact[: limit - 1] + "…"


def extract_percent(current: float, duration: float) -> int:
    if duration <= 0:
        return 0
    return max(0, min(100, int(round(current / duration * 100))))


class ExtractProgress:
    """Logs Whisper extract progress, stalls, and failures to the API console."""

    def __init__(self, duration: float, *, label: str = "", live: bool = False) -> None:
        self.duration = max(0.0, duration)
        self.label = label.strip()
        self.live = live
        self.last_t = 0.0
        self.chars = 0
        self.segments = 0
        self.started = time.monotonic()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def _tag(self) -> str:
        return f"EXTRACT {self.label}".strip() if self.label else "EXTRACT"

    def start(self, *, language: str | None = None, model: str | None = None) -> None:
        extra = []
        if model:
            extra.append(f"modelo={model}")
        if language:
            extra.append(f"idioma={language}")
        extra.append(f"duración={self.duration:.1f}s")
        extra.append(f"ventanas~{max(1, int((self.duration + _CHUNK_SECONDS - 0.01) // _CHUNK_SECONDS))}")
        logger.info("%s empezando %s", self._tag(), " ".join(extra))
        if self.live:
            return
        self._thread = threading.Thread(target=self._heartbeat, name="extract-progress", daemon=True)
        self._thread.start()

    def segment(self, end: float, text: str) -> None:
        self.last_t = max(self.last_t, float(end or 0.0))
        self.chars += len(text)
        self.segments += 1
        snippet = _preview(text)
        logger.info(
            "%s progreso %s elapsed=%.1fs «%s»",
            self._tag(),
            self._status(),
            time.monotonic() - self.started,
            snippet,
        )

    def done(self, text_len: int) -> None:
        self.stop()
        logger.info(
            "%s listo %s chars=%s segmentos=%s elapsed=%.1fs",
            self._tag(),
            self._status(),
            text_len,
            self.segments,
            time.monotonic() - self.started,
        )

    def fail(self, exc: BaseException) -> None:
        self.stop()
        logger.error(
            "%s falló %s elapsed=%.1fs detail=%s",
            self._tag(),
            self._status(),
            time.monotonic() - self.started,
            str(exc).strip() or type(exc).__name__,
        )

    def stop(self) -> None:
        self._stop.set()

    def _status(self) -> str:
        pct = extract_percent(self.last_t, self.duration)
        if self.duration > 0:
            return f"{self.last_t:.1f}/{self.duration:.1f}s ({pct}%)"
        return f"{self.last_t:.1f}s chars={self.chars}"

    def _heartbeat(self) -> None:
        last_seen = (self.last_t, self.chars)
        while not self._stop.wait(_PROGRESS_BEAT_S):
            elapsed = time.monotonic() - self.started
            stuck = (self.last_t, self.chars) == last_seen
            last_seen = (self.last_t, self.chars)
            if stuck:
                logger.warning(
                    "%s sin avance en %.0fs %s chars=%s elapsed=%.0fs — Whisper sigue dentro de una ventana o está trabado",
                    self._tag(),
                    _PROGRESS_BEAT_S,
                    self._status(),
                    self.chars,
                    elapsed,
                )
            else:
                logger.info(
                    "%s sigue %s chars=%s elapsed=%.0fs",
                    self._tag(),
                    self._status(),
                    self.chars,
                    elapsed,
                )


def pcm16_to_float32(pcm16: bytes):
    import numpy as np

    samples = np.frombuffer(pcm16, dtype=np.int16)
    if samples.size == 0:
        return np.zeros(0, dtype=np.float32)
    return np.ascontiguousarray(samples.astype(np.float32) / 32768.0)


def decode_audio_file(path: str):
    """Decode with ffmpeg so malformed webm cannot stall PyAV inside Whisper.

    Chrome MediaRecorder files often have no duration. If ffmpeg cannot parse
    them, fall back to the original path instead of failing the extract.
    """
    import numpy as np
    import subprocess

    logger.info("EXTRACT leyendo audio con ffmpeg path=%s", path)
    try:
        proc = subprocess.run(
            [
                "ffmpeg",
                "-nostdin",
                "-hide_banner",
                "-loglevel",
                "error",
                "-probesize",
                "65536",
                "-analyzeduration",
                "1000000",
                "-fflags",
                "+genpts+discardcorrupt",
                "-err_detect",
                "ignore_err",
                "-i",
                path,
                "-ac",
                "1",
                "-ar",
                str(_SAMPLE_RATE),
                "-t",
                str(_MAX_FILE_SECONDS),
                "-f",
                "s16le",
                "-acodec",
                "pcm_s16le",
                "pipe:1",
            ],
            capture_output=True,
            timeout=_FFMPEG_TIMEOUT_S,
            check=False,
        )
    except FileNotFoundError:
        return path
    except subprocess.TimeoutExpired:
        logger.warning("EXTRACT ffmpeg tardó demasiado path=%s; Whisper abrirá el archivo", path)
        return path
    if proc.returncode != 0 or not proc.stdout:
        detail = (proc.stderr or b"").decode("utf-8", "ignore").strip()
        logger.warning("EXTRACT ffmpeg falló path=%s detail=%s; Whisper abrirá el archivo", path, detail[:240])
        return path
    samples = np.frombuffer(proc.stdout, dtype=np.int16)
    if samples.size == 0:
        logger.warning("EXTRACT ffmpeg devolvió audio vacío path=%s; Whisper abrirá el archivo", path)
        return path
    audio = np.ascontiguousarray(samples.astype(np.float32) / 32768.0)
    logger.info("EXTRACT audio listo path=%s duración=%.2fs", path, audio.size / _SAMPLE_RATE)
    return audio


def _run_locked(work, wait_log: str | None = None):
    tag = wait_log or "EXTRACT"
    waited_from = time.monotonic()
    if wait_log:
        logger.info("%s esperando turno de Whisper", tag)
    acquired = _INFER_LOCK.acquire(timeout=_LOCK_WAIT_S)
    if not acquired:
        logger.error("%s Whisper ocupado durante %.0fs — abortando", tag, _LOCK_WAIT_S)
        raise TranscriptionError("El transcriptor está ocupado. Espera un momento y vuelve a intentar.")
    waited = time.monotonic() - waited_from
    if waited > 0.05:
        logger.info("%s Whisper libre tras %.1fs", tag, waited)
    try:
        return work()
    finally:
        _INFER_LOCK.release()


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
        self._load()

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
        def work() -> TranscriptResult:
            waited = time.monotonic()
            model = self._load()
            kwargs = openai_whisper_decode_options(live=live, language=language)
            started = time.monotonic()
            result = model.transcribe(audio, **kwargs)
            elapsed = time.monotonic() - started
            raw_segments = result.get("segments") or []
            text = str(result.get("text", "")).strip()
            detected = result.get("language")
            logger.info(
                "Whisper done live=%s elapsed_s=%.2f chars=%s load_s=%.2f",
                live,
                elapsed,
                len(text),
                started - waited,
            )
            return TranscriptResult(
                text=text,
                language=str(detected) if detected else language,
                segments=_segments_from_whisper(raw_segments),
                provider=self.name,
                model_name=self.model_name,
            )

        return _run_locked(work)

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
            audio = await asyncio.to_thread(decode_audio_file, str(path))
            result = await asyncio.to_thread(self._transcribe_audio, audio, language, live)
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
        except TranscriptionError:
            raise
        except Exception as exc:
            raise TranscriptionError("Transcription failed") from exc
        logger.info("Transcription completed live=%s", live)
        return result

    async def transcribe_samples(
        self,
        audio,
        language: str | None = None,
        progress_callback: callable | None = None,
    ) -> TranscriptResult:
        if progress_callback:
            progress_callback(5)
        result = await asyncio.to_thread(self._transcribe_audio, audio, language, False)
        if progress_callback:
            progress_callback(100)
        return result


class FasterWhisperTranscriptionProvider(TranscriptionProvider):
    name = "faster-whisper"
    is_cloud = False

    def __init__(self, model_name: str = "base", max_bytes: int = 500 * 1024 * 1024) -> None:
        self.model_name = model_name
        self.max_bytes = max_bytes
        self._model = None

    def warmup(self) -> None:
        self._load()

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

    def _decode_once(self, audio, language: str | None, live: bool) -> TranscriptResult:
        duration = _audio_seconds(audio)
        progress = ExtractProgress(duration, live=live)
        waited = time.monotonic()
        try:
            model = self._load()
            options = faster_whisper_decode_options(live=live, language=language)
            progress.start(language=language, model=self.model_name)
            started = time.monotonic()
            logger.info(
                "%s Whisper transcribe() arrancó live=%s load_s=%.2f",
                progress._tag(),
                live,
                started - waited,
            )
            segments_iter, info = model.transcribe(audio, **options)
            detected = getattr(info, "language", language)
            info_duration = float(getattr(info, "duration", 0.0) or 0.0)
            if info_duration > 0:
                progress.duration = info_duration
            logger.info(
                "%s modelo listo idioma=%s duración=%.1fs — iterando segmentos",
                progress._tag(),
                detected or "auto",
                progress.duration,
            )
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
                progress.segment(float(seg.end), text)
            elapsed = time.monotonic() - started
            joined = " ".join(parts).strip()
            progress.done(len(joined))
            logger.info(
                "faster-whisper done live=%s elapsed_s=%.2f chars=%s load_s=%.2f",
                live,
                elapsed,
                len(joined),
                started - waited,
            )
            return TranscriptResult(
                text=joined,
                language=str(detected) if detected else language,
                segments=segments,
                provider=self.name,
                model_name=self.model_name,
            )
        except Exception as exc:
            progress.fail(exc)
            logger.exception("%s excepción en Whisper", progress._tag())
            raise
        finally:
            progress.stop()

    def _transcribe_audio(self, audio, language: str | None, live: bool) -> TranscriptResult:
        tag = "EXTRACT"
        waited = time.monotonic()
        result = _run_locked(lambda: self._decode_once(audio, language, live), wait_log=tag)
        lock_wait = time.monotonic() - waited
        if lock_wait > 0.05:
            logger.info("%s espera de candado=%.2fs live=%s", tag, lock_wait, live)
        return result

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
        logger.info("EXTRACT Transcription started live=%s path=%s", live, path.name)
        try:
            audio = await asyncio.to_thread(decode_audio_file, str(path))
            result = await asyncio.to_thread(self._transcribe_audio, audio, language, live)
        except TranscriptionError as exc:
            logger.error("EXTRACT TranscriptionError live=%s detail=%s", live, exc)
            raise
        except Exception as exc:
            logger.exception("EXTRACT crashed live=%s", live)
            raise TranscriptionError("Transcription failed") from exc
        logger.info("EXTRACT Transcription completed live=%s chars=%s", live, len(result.text or ""))
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

    async def transcribe_samples(
        self,
        audio,
        language: str | None = None,
        progress_callback: callable | None = None,
    ) -> TranscriptResult:
        if progress_callback:
            progress_callback(5)
        result = await asyncio.to_thread(self._transcribe_audio, audio, language, False)
        if progress_callback:
            progress_callback(100)
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
