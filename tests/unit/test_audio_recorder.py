from __future__ import annotations

from pathlib import Path

import pytest

from app.domain.models.enums import RecorderState
from app.infrastructure.audio.recorder import AudioRecorder, RecorderError
from app.infrastructure.audio.wav_writer import pcm16_rms


def _silence(frames: int = 1600) -> bytes:
    return b"\x00\x00" * frames


def test_recorder_start_pause_resume_stop(tmp_path: Path) -> None:
    path = tmp_path / "take.wav"
    recorder = AudioRecorder(sample_rate=16000, channels=1)
    recorder.start(path)
    assert recorder.state == RecorderState.RECORDING
    recorder.feed(_silence())
    recorder.pause()
    assert recorder.state == RecorderState.PAUSED
    paused_duration = recorder.duration_seconds
    recorder.feed(_silence())
    assert recorder.duration_seconds == paused_duration
    recorder.resume()
    recorder.feed(_silence(3200))
    result = recorder.stop()
    assert result.path == path
    assert result.duration_seconds > 0
    assert path.exists()
    assert recorder.state == RecorderState.IDLE


def test_cannot_pause_when_idle() -> None:
    recorder = AudioRecorder()
    with pytest.raises(RecorderError):
        recorder.pause()


def test_cannot_double_start(tmp_path: Path) -> None:
    recorder = AudioRecorder()
    recorder.start(tmp_path / "a.wav")
    with pytest.raises(RecorderError):
        recorder.start(tmp_path / "b.wav")
    recorder.stop()


def test_size_limit(tmp_path: Path) -> None:
    recorder = AudioRecorder(max_bytes=100)
    recorder.start(tmp_path / "big.wav")
    with pytest.raises(RecorderError):
        recorder.feed(b"\x00" * 200)


def test_pcm_rms_range() -> None:
    assert pcm16_rms(b"") == 0.0
    assert 0.0 <= pcm16_rms(b"\x00\x10" * 64) <= 1.0
