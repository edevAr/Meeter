from __future__ import annotations

from pathlib import Path

from app.application.services.recording_service import RecordingService, format_duration
from app.config.settings import Settings
from app.domain.models.enums import AudioSourceType, RecordingStatus
from app.infrastructure.audio.recorder import RecordingResult
from app.infrastructure.audio.wav_writer import write_silence_wav


def test_format_duration() -> None:
    assert format_duration(12) == "12 sec"
    assert "min" in format_duration(90)
    assert "hr" in format_duration(3700)


def test_create_and_list(uow_factory, settings: Settings, tmp_path: Path) -> None:
    service = RecordingService(uow_factory, settings)
    wav = tmp_path / "recordings" / "demo.wav"
    wav.parent.mkdir(exist_ok=True)
    write_silence_wav(wav, 0.2)
    result = RecordingResult(path=wav, duration_seconds=0.2, bytes_written=wav.stat().st_size)
    recording = service.create_from_capture(result, "Standup", AudioSourceType.MICROPHONE)
    assert recording.status == RecordingStatus.RECORDED
    listed = service.list_recordings()
    assert len(listed) == 1
    assert listed[0].title == "Standup"


def test_delete_removes_file(uow_factory, settings: Settings, tmp_path: Path) -> None:
    service = RecordingService(uow_factory, settings)
    wav = settings.recordings_path / "gone.wav"
    write_silence_wav(wav, 0.1)
    result = RecordingResult(path=wav, duration_seconds=0.1, bytes_written=wav.stat().st_size)
    recording = service.create_from_capture(result, "Temp", AudioSourceType.MICROPHONE)
    assert wav.exists()
    service.delete(recording.id)
    assert service.get(recording.id) is None
    assert not wav.exists()


def test_counts(uow_factory, settings: Settings, tmp_path: Path) -> None:
    service = RecordingService(uow_factory, settings)
    wav = settings.recordings_path / "a.wav"
    write_silence_wav(wav, 0.1)
    result = RecordingResult(path=wav, duration_seconds=0.1, bytes_written=wav.stat().st_size)
    recording = service.create_from_capture(result, "A", AudioSourceType.MICROPHONE)
    service.mark_status(recording.id, RecordingStatus.TRANSCRIBED)
    counts = service.counts()
    assert counts["recordings"] == 1
    assert counts["transcribed"] == 1
    assert counts["analyzed"] == 0


def test_save_upload(uow_factory, settings: Settings) -> None:
    service = RecordingService(uow_factory, settings)
    wav = settings.recordings_path / "src.wav"
    write_silence_wav(wav, 0.1)
    recording = service.save_upload(
        original_name="call.wav",
        data=wav.read_bytes(),
        title="Mobile capture",
        duration_seconds=0.1,
    )
    assert recording.device_name == "mobile"
    assert Path(recording.file_path).exists()
    assert recording.status == RecordingStatus.RECORDED
