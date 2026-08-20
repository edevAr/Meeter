from __future__ import annotations

from fastapi import APIRouter, Depends, Query

from app.api.deps import get_container
from app.api.routes.recordings import recording_out
from app.api.schemas import DashboardOut, MetaOut, SearchHitOut, SearchOut
from app.container import AppContainer

router = APIRouter(prefix="/api", tags=["workspace"])


@router.get("/dashboard", response_model=DashboardOut)
def dashboard(container: AppContainer = Depends(get_container)) -> DashboardOut:
    snapshot = container.dashboard.snapshot()
    return DashboardOut(
        recordings=snapshot.recordings,
        transcribed=snapshot.transcribed,
        analyzed=snapshot.analyzed,
        recent=[recording_out(item) for item in snapshot.recent],
    )


@router.get("/search", response_model=SearchOut)
def search(
    q: str = Query(min_length=2),
    container: AppContainer = Depends(get_container),
) -> SearchOut:
    found = container.search.search(q)
    hits: list[SearchHitOut] = []
    for recording in found.recordings:
        hits.append(
            SearchHitOut(
                kind="recording",
                id=recording.id,
                recording_id=recording.id,
                title=recording.title,
                snippet=recording.title,
            )
        )
    for transcript in found.transcripts:
        snippet = transcript.text[:160] + ("…" if len(transcript.text) > 160 else "")
        hits.append(
            SearchHitOut(
                kind="transcript",
                id=transcript.id,
                recording_id=transcript.recording_id,
                title="Transcript",
                snippet=snippet,
            )
        )
    for analysis in found.analyses:
        topics = ", ".join(t.topic for t in analysis.key_topics) or analysis.summary[:120]
        hits.append(
            SearchHitOut(
                kind="analysis",
                id=analysis.id,
                recording_id=analysis.recording_id,
                title="AI analysis",
                snippet=topics,
            )
        )
    for item in found.action_items:
        hits.append(
            SearchHitOut(
                kind="action_item",
                id=item.id,
                recording_id=item.recording_id,
                title=item.recording_title or "Action item",
                snippet=item.task,
            )
        )
    return SearchOut(query=q, results=hits)


@router.get("/meta", response_model=MetaOut)
def meta(container: AppContainer = Depends(get_container)) -> MetaOut:
    settings = container.settings
    return MetaOut(
        transcription_provider=settings.transcription_provider,
        transcription_is_cloud=container.transcription.is_cloud,
        allow_cloud_transcription=settings.allow_cloud_transcription,
        ai_provider=settings.ai_provider,
        ai_model=settings.ai_model,
        ai_is_cloud=container.ai.is_cloud,
        default_language=settings.default_language,
        api_key_configured=bool(settings.ai_api_key.strip()),
    )
