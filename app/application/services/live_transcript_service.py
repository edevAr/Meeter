from __future__ import annotations

import asyncio
import logging
import re
import tempfile
import time
from pathlib import Path
from uuid import uuid4

from app.domain.interfaces.transcription import TranscriptionProvider
from app.infrastructure.audio.wav_writer import WavWriter, pcm16_rms

logger = logging.getLogger(__name__)

_WORD_RE = re.compile(r"[a-záéíóúñü0-9]+", re.IGNORECASE)


def tokenize(text: str) -> list[str]:
    return _WORD_RE.findall((text or "").lower())


def collapse_repeats(words: list[str]) -> list[str]:
    """Remove adjacent duplicated phrases (hola mundo hola mundo → hola mundo)."""
    words = list(words)
    changed = True
    while changed and len(words) >= 4:
        changed = False
        for size in range(len(words) // 2, 1, -1):
            index = 0
            while index + 2 * size <= len(words):
                if words[index : index + size] == words[index + size : index + 2 * size]:
                    words = words[: index + size] + words[index + 2 * size :]
                    changed = True
                    break
                index += 1
            if changed:
                break
    return words


def merge_transcript(previous: str, incoming: str) -> str:
    """Merge two captions into one document. Restatements extend; they never concatenate."""
    prev = collapse_repeats(tokenize(previous))
    new = collapse_repeats(tokenize(incoming))
    if not new:
        return " ".join(prev)
    if not prev:
        return " ".join(new)
    if prev == new or (len(new) >= 2 and _contains_seq(prev, new)):
        return " ".join(prev)
    if _is_prefix(new, prev):
        return " ".join(new)
    if _is_prefix(prev, new):
        return " ".join(prev)
    restated_at = _find_seq(new, prev)
    if restated_at is not None:
        extra = _usable_extra(prev, new[restated_at + len(prev) :])
        return " ".join(collapse_repeats(prev + extra) if extra else prev)
    used = _suffix_prefix_overlap(prev, new)
    for length in range(len(new), used, -1):
        if _contains_seq(prev, new[:length]):
            used = length
            break
    extra = _usable_extra(prev, new[used:])
    if not extra:
        return " ".join(prev)
    return " ".join(collapse_repeats(prev + extra))


def _usable_extra(prev: list[str], extra: list[str]) -> list[str]:
    extra = collapse_repeats(extra)
    if not extra:
        return []
    if extra == prev or _is_prefix(prev, extra):
        return []
    recent = prev[-max(len(extra) + 12, 40) :]
    if _contains_seq(recent, extra):
        return []
    return extra


def _is_prefix(haystack: list[str], needle: list[str]) -> bool:
    return len(haystack) >= len(needle) and haystack[: len(needle)] == needle


def _suffix_prefix_overlap(left: list[str], right: list[str]) -> int:
    for count in range(min(len(left), len(right)), 0, -1):
        if left[-count:] == right[:count]:
            return count
    return 0


def _find_seq(haystack: list[str], needle: list[str]) -> int | None:
    if not needle or len(needle) > len(haystack):
        return None
    span = len(needle)
    for index in range(0, len(haystack) - span + 1):
        if haystack[index : index + span] == needle:
            return index
    return None


def _contains_seq(haystack: list[str], needle: list[str]) -> bool:
    if not needle or len(needle) > len(haystack):
        return False
    span = len(needle)
    for index in range(0, len(haystack) - span + 1):
        if haystack[index : index + span] == needle:
            return True
    return False


class LiveTranscriptSession:
    """Transcribes short rolling windows so live captions do not stall."""

    def __init__(
        self,
        provider: TranscriptionProvider,
        sample_rate: int = 16000,
        chunk_seconds: float = 2.8,
        overlap_seconds: float = 0.45,
    ) -> None:
        self.provider = provider
        self.sample_rate = sample_rate
        self.chunk_bytes = max(2, int(chunk_seconds * sample_rate * 2))
        self.overlap_bytes = max(0, int(overlap_seconds * sample_rate * 2))
        self.pcm = bytearray()
        self._cursor = 0
        self._lock = asyncio.Lock()
        self._busy = False
        self.last_text = ""
        self._last_run = 0.0
        self.debug_reason = "init"
        self.debug_rms = 0.0
        self.debug_chunk = ""
        self.debug_pcm_frames = 0
        self.debug_skip_ahead = 0
        self._max_pending_bytes = sample_rate * 2 * 12

    async def add_pcm(self, chunk: bytes) -> None:
        async with self._lock:
            self.pcm.extend(chunk)
            self.debug_pcm_frames += 1
            # Moving the cursor while Whisper is in flight rewinds it when the
            # snapshot finishes (it writes the old next_cursor) and drops the
            # window currently being transcribed.
            if not self._busy:
                self._cap_pending()

    def debug_status(self) -> dict:
        pending = max(0, len(self.pcm) - self._cursor)
        busy_s = (time.monotonic() - self._last_run) if self._busy and self._last_run else 0.0
        return {
            "busy": self._busy,
            "busy_seconds": round(busy_s, 2),
            "reason": self.debug_reason,
            "rms": round(self.debug_rms, 5),
            "chunk": self.debug_chunk,
            "last_text": self.last_text,
            "pending_seconds": round(pending / (self.sample_rate * 2), 3),
            "pcm_frames": self.debug_pcm_frames,
            "skip_ahead_bytes": self.debug_skip_ahead,
        }

    @property
    def duration_seconds(self) -> float:
        return len(self.pcm) / (self.sample_rate * 2)

    async def transcribe_snapshot(self, force: bool = False) -> str | None:
        async with self._lock:
            if self._busy:
                self.debug_reason = "busy"
                return None
            pending = len(self.pcm) - self._cursor
            if pending < 2:
                self.debug_reason = "empty-buffer"
                return None
            if not force and pending < self.chunk_bytes:
                self.debug_reason = "wait-chunk"
                return None
            start = max(0, self._cursor - self.overlap_bytes) if self._cursor else 0
            window = self.chunk_bytes + self.overlap_bytes if force else self.chunk_bytes
            end = min(len(self.pcm), self._cursor + window)
            payload = bytes(self.pcm[start:end])
            next_cursor = end
            self._busy = True
            self.debug_reason = "transcribing"
            self._last_run = time.monotonic()
        try:
            rms = pcm16_rms(payload)
            self.debug_rms = rms
            if rms < 0.0015 and not force:
                self.debug_reason = "silence"
                self.debug_chunk = ""
                logger.info(
                    "CLIPPY-LIVE snapshot skip=silence rms=%.5f seconds=%.2f",
                    rms,
                    len(payload) / (self.sample_rate * 2),
                )
                async with self._lock:
                    self._commit_cursor(next_cursor)
                return None
            self.debug_reason = "transcribing"
            logger.info(
                "CLIPPY-LIVE snapshot whisper-start rms=%.5f seconds=%.2f force=%s pending_s=%.2f",
                rms,
                len(payload) / (self.sample_rate * 2),
                force,
                pending / (self.sample_rate * 2),
            )
            transcribe_pcm = getattr(self.provider, "transcribe_pcm", None)
            if callable(transcribe_pcm):
                result = await transcribe_pcm(
                    payload,
                    sample_rate=self.sample_rate,
                    language="es",
                    live=True,
                )
            else:
                result = await self._transcribe_wav(payload)
            elapsed = time.monotonic() - self._last_run
            chunk = (result.text or "").strip()
            self.debug_chunk = chunk
            logger.info("CLIPPY-LIVE snapshot whisper-done elapsed_s=%.2f chunk=%r", elapsed, chunk)
            if chunk:
                merged = merge_transcript(self.last_text, chunk)
                changed = merged != self.last_text
                self.last_text = merged
                async with self._lock:
                    self._commit_cursor(next_cursor)
                if changed:
                    self.debug_reason = "ok"
                    logger.info("CLIPPY-LIVE snapshot ok chunk=%r merged=%r", chunk, merged)
                    return merged
                self.debug_reason = "unchanged"
                logger.info("CLIPPY-LIVE snapshot skip=unchanged chunk=%r", chunk)
                return None
            self.debug_reason = "whisper-empty"
            logger.info("CLIPPY-LIVE snapshot skip=whisper-empty rms=%.5f elapsed_s=%.2f", rms, elapsed)
            async with self._lock:
                self._commit_cursor(next_cursor)
            return None
        except Exception:
            self.debug_reason = "error"
            logger.exception("CLIPPY-LIVE snapshot failed")
            return None
        finally:
            async with self._lock:
                self._busy = False

    async def _transcribe_wav(self, payload: bytes):
        path = Path(tempfile.gettempdir()) / f"live-{uuid4()}.wav"
        try:
            writer = WavWriter(path, sample_rate=self.sample_rate)
            writer.open()
            writer.write(payload)
            writer.close()
            return await self.provider.transcribe(str(path), language="es")
        finally:
            try:
                path.unlink(missing_ok=True)
            except Exception:
                pass

    def _cap_pending(self) -> None:
        pending = len(self.pcm) - self._cursor
        if pending <= self._max_pending_bytes:
            return
        dropped = pending - self._max_pending_bytes
        self._cursor += dropped
        self.debug_skip_ahead += dropped

    def _commit_cursor(self, next_cursor: int) -> None:
        self._cursor = next_cursor
        self._cap_pending()
        self._trim()

    def _trim(self) -> None:
        keep = self.overlap_bytes + self.chunk_bytes
        if self._cursor <= keep:
            return
        cut = self._cursor - keep
        del self.pcm[:cut]
        self._cursor -= cut
