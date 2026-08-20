from __future__ import annotations

from pathlib import Path

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from fastapi.responses import FileResponse

from app.api.deps import get_container
from app.api.schemas import (
    AnalysisOut,
    MessageOut,
    NoteOut,
    RecordingCreate,
    RecordingNotesCreate,
    RecordingOut,
    TaskOut,
    TranscriptOut,
    TranscriptSegmentOut,
    TranscribeRequest,
)
from app.container import AppContainer
from app.domain.interfaces.export import ExportFormat
from app.domain.models.analysis import MeetingAnalysis
from app.domain.models.enums import AudioSourceType, RecordingStatus
from app.domain.models.recording import Recording
from app.domain.models.transcript import Transcript
from app.infrastructure.audio.recorder import RecordingResult
from app.infrastructure.ai.llm_provider import AIProviderError
from app.infrastructure.security.files import FileValidationError, validate_audio_path

router = APIRouter(prefix="/api/recordings", tags=["recordings"])

_AUDIO_MEDIA = {
    ".wav": "audio/wav",
    ".m4a": "audio/mp4",
    ".mp3": "audio/mpeg",
    ".flac": "audio/flac",
    ".ogg": "audio/ogg",
    ".webm": "audio/webm",
}


def recording_out(item: Recording) -> RecordingOut:
    payload = item.model_dump()
    payload["audio_url"] = f"/api/recordings/{item.id}/audio"
    return RecordingOut.model_validate(payload)


def transcript_out(item: Transcript) -> TranscriptOut:
    return TranscriptOut(
        id=item.id,
        recording_id=item.recording_id,
        text=item.text,
        language=item.language,
        created_at=item.created_at,
        provider=item.provider,
        model_name=item.model_name,
        segments=[
            TranscriptSegmentOut(
                id=seg.id,
                start_time=seg.start_time,
                end_time=seg.end_time,
                speaker=seg.speaker,
                text=seg.text,
                sequence=seg.sequence,
            )
            for seg in item.segments
        ],
    )


def analysis_out(item: MeetingAnalysis) -> AnalysisOut:
    return AnalysisOut(
        id=item.id,
        recording_id=item.recording_id,
        transcript_id=item.transcript_id,
        summary=item.summary,
        created_at=item.created_at,
        provider=item.provider,
        model_name=item.model_name,
        participants=item.participants,
        key_topics=[t.topic for t in item.key_topics],
        decisions=[d.text for d in item.decisions],
    )


@router.get("", response_model=list[RecordingOut])
def list_recordings(container: AppContainer = Depends(get_container)) -> list[RecordingOut]:
    return [recording_out(item) for item in container.recordings.list_recordings()]


@router.post("", response_model=RecordingOut, status_code=201)
def create_recording(
    payload: RecordingCreate,
    container: AppContainer = Depends(get_container),
) -> RecordingOut:
    if not payload.file_path:
        recording, _path = container.recordings.create_placeholder(payload.title, payload.source)
        recording = container.recordings.mark_status(recording.id, RecordingStatus.RECORDED)
        return recording_out(recording)
    try:
        path = validate_audio_path(
            Path(payload.file_path),
            container.settings.max_recording_bytes,
            must_exist=True,
        )
    except FileValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    result = RecordingResult(
        path=path,
        duration_seconds=payload.duration_seconds,
        bytes_written=path.stat().st_size,
    )
    recording = container.recordings.create_from_capture(
        result,
        payload.title,
        payload.source or AudioSourceType.MICROPHONE,
    )
    return recording_out(recording)


@router.post("/upload", response_model=RecordingOut, status_code=201)
async def upload_recording(
    file: UploadFile = File(...),
    title: str = Form("Untitled recording"),
    duration_seconds: float = Form(0.0),
    source: AudioSourceType = Form(AudioSourceType.MICROPHONE),
    container: AppContainer = Depends(get_container),
) -> RecordingOut:
    data = await file.read()
    name = file.filename or "recording.m4a"
    try:
        recording = container.recordings.save_upload(
            original_name=name,
            data=data,
            title=title,
            duration_seconds=duration_seconds,
            source=source,
            device_name="mobile",
        )
    except FileValidationError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    return recording_out(recording)


@router.get("/{recording_id}", response_model=RecordingOut)
def get_recording(recording_id: str, container: AppContainer = Depends(get_container)) -> RecordingOut:
    recording = container.recordings.get(recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    return recording_out(recording)


@router.get("/{recording_id}/audio")
def get_recording_audio(recording_id: str, container: AppContainer = Depends(get_container)) -> FileResponse:
    recording = container.recordings.get(recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    path = Path(recording.file_path)
    if not path.is_file():
        raise HTTPException(status_code=404, detail="Audio file not found")
    media = _AUDIO_MEDIA.get(path.suffix.lower(), "application/octet-stream")
    return FileResponse(path, media_type=media, filename=path.name)


@router.delete("/{recording_id}", response_model=MessageOut)
def delete_recording(recording_id: str, container: AppContainer = Depends(get_container)) -> MessageOut:
    try:
        container.recordings.delete(recording_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc
    return MessageOut(detail="Recording deleted")


@router.post("/{recording_id}/transcribe", response_model=TranscriptOut)
async def transcribe_recording(
    recording_id: str,
    payload: TranscribeRequest | None = None,
    container: AppContainer = Depends(get_container),
) -> TranscriptOut:
    language = payload.language if payload else None
    try:
        transcript = await container.transcriptions.transcribe(recording_id, language=language)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Transcription failed") from exc
    return transcript_out(transcript)


@router.get("/{recording_id}/transcript", response_model=TranscriptOut)
def get_transcript(recording_id: str, container: AppContainer = Depends(get_container)) -> TranscriptOut:
    transcript = container.transcriptions.get_for_recording(recording_id)
    if transcript is None:
        raise HTTPException(status_code=404, detail="Transcript not found")
    return transcript_out(transcript)


@router.post("/{recording_id}/analyze", response_model=AnalysisOut)
async def analyze_recording(
    recording_id: str,
    container: AppContainer = Depends(get_container),
) -> AnalysisOut:
    try:
        analysis = await container.analysis.analyze(recording_id)
    except KeyError as exc:
        raise HTTPException(status_code=404, detail="Recording not found") from exc
    except AIProviderError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=400, detail="AI analysis failed") from exc
    return analysis_out(analysis)


@router.get("/{recording_id}/analysis", response_model=AnalysisOut)
def get_analysis(recording_id: str, container: AppContainer = Depends(get_container)) -> AnalysisOut:
    analysis = container.analysis.get_for_recording(recording_id)
    if analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    return analysis_out(analysis)


@router.post("/{recording_id}/notes", status_code=201)
def notes_from_recording(
    recording_id: str,
    payload: RecordingNotesCreate,
    container: AppContainer = Depends(get_container),
) -> dict:
    recording = container.recordings.get(recording_id)
    if recording is None:
        raise HTTPException(status_code=404, detail="Recording not found")
    analysis = container.analysis.get_for_recording(recording_id)
    transcript = container.transcriptions.get_for_recording(recording_id)
    notes: list[NoteOut] = []
    tasks: list[TaskOut] = []
    if payload.include_summary:
        body = analysis.summary if analysis else (transcript.text if transcript else "")
        if body.strip():
            note = container.notes.from_recording(
                recording_id=recording_id,
                title=f"Resumen · {recording.title}",
                body=body.strip(),
                color="yellow",
            )
            notes.append(NoteOut.model_validate(note.model_dump()))
    if analysis and payload.include_decisions:
        for decision in analysis.decisions:
            note = container.notes.from_recording(
                recording_id=recording_id,
                title=f"Decisión · {recording.title}",
                body=decision.text,
                color="mint",
            )
            notes.append(NoteOut.model_validate(note.model_dump()))
    if analysis and payload.include_topics:
        topics = "\n".join(f"• {topic.topic}" for topic in analysis.key_topics)
        if topics:
            note = container.notes.from_recording(
                recording_id=recording_id,
                title=f"Temas · {recording.title}",
                body=topics,
                color="sky",
            )
            notes.append(NoteOut.model_validate(note.model_dump()))
    if payload.include_action_items:
        from datetime import date

        today = date.today().isoformat()
        for item in container.action_items.for_recording(recording_id):
            if payload.create_tasks:
                task = container.tasks.create(
                    title=item.task,
                    details=item.recording_title or recording.title,
                    due_date=item.due_date or today,
                    priority=item.priority,
                    source="call",
                    recording_id=recording_id,
                )
                tasks.append(TaskOut.model_validate(task.model_dump()))
            else:
                note = container.notes.from_recording(
                    recording_id=recording_id,
                    title=item.task,
                    body=item.display_owner(),
                    color="rose",
                )
                notes.append(NoteOut.model_validate(note.model_dump()))
    if not notes and not tasks:
        raise HTTPException(
            status_code=400,
            detail="Transcribe and analyze the call before creating notes",
        )
    return {"notes": notes, "tasks": tasks}


@router.get("/{recording_id}/export/transcript")
def export_transcript(
    recording_id: str,
    format: str = Query(default="md"),
    container: AppContainer = Depends(get_container),
) -> FileResponse:
    recording = container.recordings.get(recording_id)
    transcript = container.transcriptions.get_for_recording(recording_id)
    if recording is None or transcript is None:
        raise HTTPException(status_code=404, detail="Transcript not found")
    try:
        fmt = ExportFormat(format)
        path = container.exports.export_transcript(recording, transcript, fmt)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Export failed") from exc
    return FileResponse(path, filename=path.name)


@router.get("/{recording_id}/export/analysis")
def export_analysis(
    recording_id: str,
    format: str = Query(default="md"),
    container: AppContainer = Depends(get_container),
) -> FileResponse:
    recording = container.recordings.get(recording_id)
    analysis = container.analysis.get_for_recording(recording_id)
    if recording is None or analysis is None:
        raise HTTPException(status_code=404, detail="Analysis not found")
    items = container.action_items.for_recording(recording_id)
    try:
        fmt = ExportFormat(format)
        path = container.exports.export_analysis(recording, analysis, items, fmt)
    except Exception as exc:
        raise HTTPException(status_code=400, detail="Export failed") from exc
    return FileResponse(path, filename=path.name)
