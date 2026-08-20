from __future__ import annotations

import asyncio
import json
import logging
from uuid import uuid4

from fastapi import APIRouter, WebSocket, WebSocketDisconnect

from app.api.deps import get_container
from app.application.services.live_transcript_service import LiveTranscriptSession

logger = logging.getLogger(__name__)

router = APIRouter(tags=["live"])


@router.websocket("/api/live/transcribe")
async def live_transcribe(websocket: WebSocket) -> None:
    await websocket.accept()
    sid = uuid4().hex[:8]
    container = get_container()
    session = LiveTranscriptSession(container.transcription)
    closed = asyncio.Event()
    send_lock = asyncio.Lock()
    pcm_bytes = 0
    logger.info("CLIPPY-LIVE %s connection open", sid)

    async def emit(payload: dict) -> None:
        if closed.is_set():
            return
        outgoing = {**payload, "sid": sid}
        async with send_lock:
            try:
                raw = json.dumps(outgoing)
                logger.info("CLIPPY-LIVE %s send %s", sid, _brief(outgoing))
                await websocket.send_text(raw)
            except Exception:
                logger.exception("CLIPPY-LIVE %s send failed", sid)
                closed.set()

    async def worker() -> None:
        while not closed.is_set():
            try:
                snapshot = await session.transcribe_snapshot()
            except asyncio.CancelledError:
                raise
            except Exception:
                logger.exception("CLIPPY-LIVE %s worker failed", sid)
                snapshot = None
            if snapshot:
                await emit({"type": "partial", "text": snapshot})
            else:
                await asyncio.sleep(0.12)

    task = asyncio.create_task(worker())
    try:
        while not closed.is_set():
            message = await websocket.receive()
            if message.get("type") == "websocket.disconnect":
                logger.info("CLIPPY-LIVE %s recv disconnect pcm_bytes=%s", sid, pcm_bytes)
                break
            data = message.get("bytes")
            text = message.get("text")
            if data:
                pcm_bytes += len(data)
                await session.add_pcm(data)
                continue
            if not text:
                continue
            payload = json.loads(text)
            kind = payload.get("type")
            logger.info("CLIPPY-LIVE %s recv %s", sid, _brief(payload))
            if kind == "probe":
                await emit({"type": "probe-ack", "seq": payload.get("seq"), **session.debug_status()})
            elif kind == "flush":
                snapshot = await session.transcribe_snapshot(force=True)
                await emit({"type": "partial", "text": snapshot or session.last_text})
            elif kind == "stop":
                closed.set()
                await _finish_worker(task, sid)
                snapshot = await session.transcribe_snapshot(force=True)
                await emit(
                    {
                        "type": "final",
                        "text": snapshot or session.last_text,
                        "duration_seconds": session.duration_seconds,
                    }
                )
                break
    except WebSocketDisconnect:
        logger.info("CLIPPY-LIVE %s client disconnected pcm_bytes=%s last=%r", sid, pcm_bytes, session.last_text)
        return
    except Exception:
        logger.exception("CLIPPY-LIVE %s socket failed", sid)
        await emit({"type": "error", "detail": "Live transcription failed"})
    finally:
        logger.info("CLIPPY-LIVE %s connection close pcm_bytes=%s last=%r", sid, pcm_bytes, session.last_text)
        closed.set()
        await _finish_worker(task, sid)


async def _finish_worker(task: asyncio.Task, sid: str) -> None:
    """Wait for the in-flight Whisper call. Cancelling it leaves a thread on the model."""
    if task.done():
        return
    try:
        await asyncio.wait_for(asyncio.shield(task), timeout=25)
    except asyncio.TimeoutError:
        logger.warning("CLIPPY-LIVE %s worker still in Whisper; leaving it to finish", sid)
    except asyncio.CancelledError:
        return


def _brief(payload: dict) -> str:
    kind = payload.get("type")
    text = payload.get("text")
    if isinstance(text, str) and len(text) > 180:
        text = text[:180] + "…"
    if kind in {"partial", "final"}:
        return f"type={kind} text={text!r}"
    if kind == "probe":
        return (
            f"type=probe seq={payload.get('seq')} frames={payload.get('pcmFrames')} "
            f"bytes={payload.get('pcmBytes')} rms={payload.get('rms')} socket={payload.get('socket')}"
        )
    if kind == "probe-ack":
        return (
            f"type=probe-ack seq={payload.get('seq')} reason={payload.get('reason')} "
            f"busy={payload.get('busy')} busy_s={payload.get('busy_seconds')} "
            f"rms={payload.get('rms')} pending_s={payload.get('pending_seconds')} "
            f"skip={payload.get('skip_ahead_bytes')} "
            f"chunk={payload.get('chunk')!r} last={payload.get('last_text')!r}"
        )
    return f"type={kind} payload={payload}"
