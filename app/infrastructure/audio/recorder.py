from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

from app.domain.interfaces.audio import AudioSource
from app.domain.models.enums import RecorderState
from app.infrastructure.audio.wav_writer import WavWriter, pcm16_rms

logger = logging.getLogger(__name__)

LevelCallback = Callable[[float, float], None]


class RecorderError(RuntimeError):
    pass


@dataclass
class RecordingResult:
    path: Path
    duration_seconds: float
    bytes_written: int


class AudioRecorder:
    """Feed-based PCM recorder. Capture backends push audio via ``feed`` or ``start_capture``."""

    def __init__(
        self,
        sample_rate: int = 16000,
        channels: int = 1,
        sample_width: int = 2,
        max_bytes: int = 500 * 1024 * 1024,
        on_level: LevelCallback | None = None,
    ) -> None:
        self.sample_rate = sample_rate
        self.channels = channels
        self.sample_width = sample_width
        self.max_bytes = max_bytes
        self.on_level = on_level
        self.state = RecorderState.IDLE
        self._writer: WavWriter | None = None
        self._lock = threading.RLock()
        self._capture_thread: threading.Thread | None = None
        self._stop_event = threading.Event()
        self._source: AudioSource | None = None
        self.level = 0.0

    def start(self, path: str | Path) -> None:
        with self._lock:
            if self.state in {RecorderState.RECORDING, RecorderState.PAUSED}:
                raise RecorderError("Recording already in progress")
            writer = WavWriter(
                Path(path),
                sample_rate=self.sample_rate,
                channels=self.channels,
                sample_width=self.sample_width,
            )
            writer.open()
            self._writer = writer
            self.state = RecorderState.RECORDING
            self.level = 0.0
            logger.info("Recording started")

    def pause(self) -> None:
        with self._lock:
            if self.state != RecorderState.RECORDING:
                raise RecorderError("Cannot pause unless recording")
            self.state = RecorderState.PAUSED
            logger.info("Recording paused")

    def resume(self) -> None:
        with self._lock:
            if self.state != RecorderState.PAUSED:
                raise RecorderError("Cannot resume unless paused")
            self.state = RecorderState.RECORDING
            logger.info("Recording resumed")

    def feed(self, pcm16: bytes) -> None:
        with self._lock:
            if self.state != RecorderState.RECORDING or self._writer is None:
                return
            if self._writer.bytes_written + len(pcm16) > self.max_bytes:
                raise RecorderError("Recording exceeded maximum allowed size")
            self._writer.write(pcm16)
            self.level = pcm16_rms(pcm16)
            if self.on_level is not None:
                self.on_level(self.level, self.duration_seconds)

    def stop(self) -> RecordingResult:
        self._stop_event.set()
        if self._capture_thread is not None and self._capture_thread.is_alive():
            self._capture_thread.join(timeout=3)
        self._capture_thread = None
        if self._source is not None:
            try:
                self._source.close()
            except Exception:
                logger.info("Audio source close failed")
            self._source = None
        with self._lock:
            if self._writer is None:
                self.state = RecorderState.IDLE
                raise RecorderError("No active recording")
            duration = self._writer.close()
            result = RecordingResult(
                path=self._writer.path,
                duration_seconds=duration,
                bytes_written=self._writer.bytes_written,
            )
            self._writer = None
            self.state = RecorderState.IDLE
            self.level = 0.0
            logger.info("Recording stopped")
            return result

    def start_capture(self, source: AudioSource, frames_per_read: int = 1024) -> None:
        if self.state != RecorderState.RECORDING:
            raise RecorderError("Call start() before start_capture()")
        self._source = source
        source.open()
        self._stop_event.clear()
        self._capture_thread = threading.Thread(
            target=self._capture_loop,
            args=(frames_per_read,),
            name="audio-capture",
            daemon=True,
        )
        self._capture_thread.start()

    def _capture_loop(self, frames_per_read: int) -> None:
        assert self._source is not None
        while not self._stop_event.is_set():
            try:
                pcm = self._source.read(frames_per_read)
            except Exception:
                logger.info("Audio capture read failed")
                break
            try:
                self.feed(pcm)
            except RecorderError:
                logger.info("Recording size limit reached")
                break

    @property
    def duration_seconds(self) -> float:
        if self._writer is None:
            return 0.0
        return self._writer.duration_seconds
