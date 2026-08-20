from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass

from app.domain.models.enums import AudioSourceType


@dataclass(frozen=True)
class AudioDevice:
    id: str
    name: str
    source_type: AudioSourceType
    is_default: bool = False
    available: bool = True
    unavailable_reason: str | None = None


class AudioSource(ABC):
    """Platform-agnostic capture source.

    Microphone is always the first-class implementation.
    System audio is optional and may be unavailable depending on OS permissions
    and virtual loopback drivers (see README).
    """

    source_type: AudioSourceType

    @abstractmethod
    def is_available(self) -> bool:
        raise NotImplementedError

    @abstractmethod
    def open(self) -> None:
        raise NotImplementedError

    @abstractmethod
    def read(self, frames: int) -> bytes:
        """Return interleaved PCM16 little-endian bytes."""
        raise NotImplementedError

    @abstractmethod
    def close(self) -> None:
        raise NotImplementedError


class CaptureBackend(ABC):
    """Starts a background capture loop that pushes PCM into a recorder."""

    @abstractmethod
    def start(self, on_pcm: callable, sample_rate: int, channels: int) -> None:
        raise NotImplementedError

    @abstractmethod
    def stop(self) -> None:
        raise NotImplementedError
