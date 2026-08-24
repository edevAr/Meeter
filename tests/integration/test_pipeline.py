from __future__ import annotations

import pytest
from fastapi.testclient import TestClient

from app.api.deps import set_container
from app.api.main import create_app
from app.application.services.action_item_service import ActionItemService
from app.application.services.agenda_service import AgendaService
from app.application.services.analysis_service import AIAnalysisService
from app.application.services.auth_service import AuthService
from app.application.services.dashboard_service import DashboardService
from app.application.services.export_service import ExportService
from app.application.services.note_service import NoteService
from app.application.services.recording_service import RecordingService
from app.application.services.search_service import SearchService
from app.application.services.task_service import TaskService
from app.application.services.transcription_service import TranscriptionService
from app.config.settings import Settings
from app.container import AppContainer
from app.domain.models.enums import AudioSourceType, RecordingStatus
from app.infrastructure.audio.recorder import RecordingResult
from app.infrastructure.audio.wav_writer import write_silence_wav
from app.infrastructure.database.session import create_engine_from_settings, init_database, make_session_factory
from tests.conftest import FakeAIProvider, FakeDiarization, FakeTranscriptionProvider


def _auth_headers(client: TestClient) -> dict[str, str]:
    created = client.post(
        "/api/auth/register",
        json={"email": "ana@meeter.test", "password": "secret123", "name": "Ana"},
    )
    if created.status_code == 201:
        token = created.json()["token"]
    else:
        login = client.post("/api/auth/login", json={"email": "ana@meeter.test", "password": "secret123"})
        token = login.json()["token"]
    return {"Authorization": f"Bearer {token}"}



def _container(settings: Settings, uow_factory) -> AppContainer:
    engine = create_engine_from_settings(settings)
    init_database(engine)
    stt = FakeTranscriptionProvider()
    ai = FakeAIProvider()
    return AppContainer(
        settings=settings,
        engine=engine,
        session_factory=make_session_factory(engine),
        transcription=stt,
        ai=ai,
        recordings=RecordingService(uow_factory, settings),
        transcriptions=TranscriptionService(uow_factory, stt, FakeDiarization(), settings.max_recording_bytes),
        analysis=AIAnalysisService(uow_factory, ai),
        action_items=ActionItemService(uow_factory),
        notes=NoteService(uow_factory),
        tasks=TaskService(uow_factory),
        agenda=AgendaService(uow_factory),
        exports=ExportService(settings),
        search=SearchService(uow_factory),
        dashboard=DashboardService(uow_factory),
        auth=AuthService(make_session_factory(engine)),
        uow_factory=uow_factory,
    )


@pytest.mark.asyncio
async def test_recording_to_analysis_pipeline(uow_factory, settings: Settings) -> None:
    container = _container(settings, uow_factory)
    wav = settings.recordings_path / "meeting.wav"
    write_silence_wav(wav, 0.4)
    recording = container.recordings.create_from_capture(
        RecordingResult(path=wav, duration_seconds=0.4, bytes_written=wav.stat().st_size),
        "Meeting with Engineering",
        AudioSourceType.MICROPHONE,
    )
    assert recording.status == RecordingStatus.RECORDED
    transcript = await container.transcriptions.transcribe(recording.id)
    assert transcript.text
    analysis = await container.analysis.analyze(recording.id)
    assert analysis.summary
    items = container.action_items.for_recording(recording.id)
    assert items[0].task == "Prepare migration script"
    finished = container.recordings.get(recording.id)
    assert finished is not None
    assert finished.status == RecordingStatus.ANALYZED
    snapshot = container.dashboard.snapshot()
    assert snapshot.analyzed == 1
    results = container.search.search("migration")
    assert results.total >= 1


def test_api_endpoints(uow_factory, settings: Settings) -> None:
    container = _container(settings, uow_factory)
    wav = settings.recordings_path / "api.wav"
    write_silence_wav(wav, 0.2)
    recording = container.recordings.create_from_capture(
        RecordingResult(path=wav, duration_seconds=0.2, bytes_written=wav.stat().st_size),
        "API meeting",
        AudioSourceType.MICROPHONE,
    )
    set_container(container)
    client = TestClient(create_app(container))
    listed = client.get("/api/recordings")
    assert listed.status_code == 200
    assert listed.json()[0]["id"] == recording.id
    transcribe = client.post(f"/api/recordings/{recording.id}/transcribe")
    assert transcribe.status_code == 200
    transcript = client.get(f"/api/recordings/{recording.id}/transcript")
    assert transcript.status_code == 200
    analyze = client.post(f"/api/recordings/{recording.id}/analyze")
    assert analyze.status_code == 200
    analysis = client.get(f"/api/recordings/{recording.id}/analysis")
    assert analysis.status_code == 200
    items = client.get("/api/action-items")
    assert items.status_code == 200
    item_id = items.json()[0]["id"]
    patched = client.patch(f"/api/action-items/{item_id}", json={"status": "completed"})
    assert patched.status_code == 200
    assert patched.json()["status"] == "completed"
    deleted = client.delete(f"/api/recordings/{recording.id}")
    assert deleted.status_code == 200
    missing = client.get(f"/api/recordings/{recording.id}")
    assert missing.status_code == 404


def test_from_call_creates_summary_note(uow_factory, settings: Settings) -> None:
    container = _container(settings, uow_factory)
    set_container(container)
    client = TestClient(create_app(container))
    created = client.post(
        "/api/notes/from-call",
        headers=_auth_headers(client),
        json={
            "transcript": "Hablamos del presupuesto. Acordamos enviar la propuesta el lunes. Hay que llamar a Ana.",
            "pos_x": 40,
            "pos_y": 90,
        },
    )
    assert created.status_code == 201
    body = created.json()
    assert body["body"]
    assert "presupuesto" in body["body"].lower() or "migration" in body["body"].lower() or body["title"]
    listed = client.get("/api/notes", headers=_auth_headers(client))
    assert any(note["id"] == body["id"] for note in listed.json())
    container = _container(settings, uow_factory)
    wav = settings.recordings_path / "phone.wav"
    write_silence_wav(wav, 0.2)
    set_container(container)
    client = TestClient(create_app(container))
    uploaded = client.post(
        "/api/recordings/upload",
        data={"title": "From phone", "duration_seconds": "0.2"},
        files={"file": ("clip.wav", wav.read_bytes(), "audio/wav")},
    )
    assert uploaded.status_code == 201
    body = uploaded.json()
    assert body["title"] == "From phone"
    assert body["audio_url"].endswith("/audio")
    audio = client.get(body["audio_url"])
    assert audio.status_code == 200
    dash = client.get("/api/dashboard")
    assert dash.status_code == 200
    assert dash.json()["recordings"] >= 1
    meta = client.get("/api/meta")
    assert meta.status_code == 200
    assert "api_key" not in meta.json()
