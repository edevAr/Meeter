from __future__ import annotations

import logging
import sys
from typing import Callable

from app.domain.interfaces.audio import AudioDevice, AudioSource
from app.domain.models.enums import AudioSourceType

logger = logging.getLogger(__name__)

OnPcm = Callable[[bytes], None]


def list_input_devices() -> list[AudioDevice]:
    devices: list[AudioDevice] = [
        AudioDevice(
            id="default",
            name="Default input device",
            source_type=AudioSourceType.DEFAULT_INPUT,
            is_default=True,
        ),
        AudioDevice(
            id="microphone",
            name="Microphone",
            source_type=AudioSourceType.MICROPHONE,
        ),
    ]
    devices.extend(_discover_host_devices())
    devices.append(_system_audio_device())
    return devices


def _discover_host_devices() -> list[AudioDevice]:
    try:
        import sounddevice as sd
    except Exception:
        return []
    found: list[AudioDevice] = []
    try:
        host_devices = sd.query_devices()
        for index, info in enumerate(host_devices):
            if int(info.get("max_input_channels", 0)) <= 0:
                continue
            name = str(info.get("name", f"Device {index}"))
            source_type = AudioSourceType.MICROPHONE
            if _looks_like_loopback(name):
                source_type = AudioSourceType.SYSTEM
            found.append(
                AudioDevice(
                    id=str(index),
                    name=name,
                    source_type=source_type,
                    is_default=False,
                )
            )
    except Exception:
        logger.info("Could not enumerate host audio devices")
    return found


def _looks_like_loopback(name: str) -> bool:
    lowered = name.lower()
    markers = (
        "blackhole",
        "soundflower",
        "loopback",
        "vb-audio",
        "cable",
        "stereo mix",
        "what u hear",
        "monitor of",
        "pulse",
        "wasapi loopback",
    )
    return any(marker in lowered for marker in markers)


def _system_audio_device() -> AudioDevice:
    reason = system_audio_limitation()
    available = any(_looks_like_loopback(d.name) for d in _discover_host_devices())
    return AudioDevice(
        id="system",
        name="System audio",
        source_type=AudioSourceType.SYSTEM,
        available=available,
        unavailable_reason=None if available else reason,
    )


def system_audio_limitation() -> str:
    platform = sys.platform
    if platform == "darwin":
        return (
            "macOS does not allow apps to capture another application's audio by default. "
            "Install a virtual loopback device such as BlackHole and select it as both "
            "the system output and this app's input."
        )
    if platform.startswith("win"):
        return (
            "Windows system-audio capture requires a loopback endpoint (WASAPI loopback "
            "or a virtual cable). This app will use it when an input named Stereo Mix, "
            "CABLE, or similar is available."
        )
    return (
        "Linux system-audio capture typically uses a PulseAudio/PipeWire monitor source. "
        "Select a device named 'Monitor of …' when it appears in the device list."
    )


class MicrophoneSource(AudioSource):
    source_type = AudioSourceType.MICROPHONE

    def __init__(self, device_id: str | None = None, sample_rate: int = 16000, channels: int = 1) -> None:
        self.device_id = device_id
        self.sample_rate = sample_rate
        self.channels = channels
        self._stream = None

    def is_available(self) -> bool:
        try:
            import sounddevice as sd  # noqa: F401
        except Exception:
            return False
        return True

    def _device_arg(self) -> int | None:
        if self.device_id in {None, "default", "microphone", ""}:
            return None
        try:
            return int(self.device_id)
        except ValueError:
            return None

    def open(self) -> None:
        import sounddevice as sd

        self._stream = sd.RawInputStream(
            samplerate=self.sample_rate,
            channels=self.channels,
            dtype="int16",
            device=self._device_arg(),
            blocksize=1024,
        )
        self._stream.start()

    def read(self, frames: int) -> bytes:
        if self._stream is None:
            raise RuntimeError("MicrophoneSource is not open")
        data, overflowed = self._stream.read(frames)
        if overflowed:
            logger.info("Audio input overflow detected")
        return bytes(data)

    def close(self) -> None:
        if self._stream is not None:
            try:
                self._stream.stop()
                self._stream.close()
            finally:
                self._stream = None


class SystemAudioSource(MicrophoneSource):
    """Uses a loopback/virtual device when the OS exposes one as an input."""

    source_type = AudioSourceType.SYSTEM

    def is_available(self) -> bool:
        device = _system_audio_device()
        return device.available

    def open(self) -> None:
        if not self.is_available() and self.device_id in {None, "system", ""}:
            raise RuntimeError(system_audio_limitation())
        loopback = next((d for d in _discover_host_devices() if d.source_type == AudioSourceType.SYSTEM), None)
        if self.device_id in {None, "system", ""} and loopback is not None:
            self.device_id = loopback.id
        super().open()
