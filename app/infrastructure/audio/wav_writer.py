from __future__ import annotations

import array
import math
import struct
import wave
from pathlib import Path


def pcm16_rms(data: bytes) -> float:
    if len(data) < 2:
        return 0.0
    samples = array.array("h")
    samples.frombytes(data[: len(data) - (len(data) % 2)])
    if not samples:
        return 0.0
    acc = 0.0
    for sample in samples:
        acc += sample * sample
    rms = math.sqrt(acc / len(samples)) / 32768.0
    return min(1.0, rms)


class WavWriter:
    """Writes 16-bit PCM WAV suitable for Whisper (mono 16 kHz by default)."""

    def __init__(self, path: Path, sample_rate: int = 16000, channels: int = 1, sample_width: int = 2) -> None:
        self.path = path
        self.sample_rate = sample_rate
        self.channels = channels
        self.sample_width = sample_width
        self._wave: wave.Wave_write | None = None
        self.bytes_written = 0

    def open(self) -> None:
        self.path.parent.mkdir(parents=True, exist_ok=True)
        self._wave = wave.open(str(self.path), "wb")
        self._wave.setnchannels(self.channels)
        self._wave.setsampwidth(self.sample_width)
        self._wave.setframerate(self.sample_rate)
        self.bytes_written = 0

    def write(self, pcm16: bytes) -> None:
        if self._wave is None:
            raise RuntimeError("WavWriter is not open")
        self._wave.writeframes(pcm16)
        self.bytes_written += len(pcm16)

    def close(self) -> float:
        duration = self.duration_seconds
        if self._wave is not None:
            self._wave.close()
            self._wave = None
        return duration

    @property
    def duration_seconds(self) -> float:
        frame_bytes = self.channels * self.sample_width
        if frame_bytes == 0 or self.sample_rate == 0:
            return 0.0
        return (self.bytes_written / frame_bytes) / self.sample_rate


def write_silence_wav(path: Path, duration_seconds: float, sample_rate: int = 16000) -> None:
    frames = int(duration_seconds * sample_rate)
    writer = WavWriter(path, sample_rate=sample_rate)
    writer.open()
    chunk = struct.pack("<" + "h" * 1600, *([0] * 1600))
    remaining = frames
    while remaining > 0:
        n = min(1600, remaining)
        if n == 1600:
            writer.write(chunk)
        else:
            writer.write(struct.pack("<" + "h" * n, *([0] * n)))
        remaining -= n
    writer.close()
