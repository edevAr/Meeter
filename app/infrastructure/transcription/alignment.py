from __future__ import annotations

from collections.abc import Sequence

from app.domain.interfaces.diarization import SpeakerTurn
from app.domain.models.transcript import TranscriptSegment


def normalize_speaker_label(raw: str | None, index: int | None = None) -> str:
    label = (raw or "").strip()
    digits = "".join(ch for ch in label if ch.isdigit())
    if digits:
        return f"SPEAKER_{int(digits):02d}"
    if label.upper().startswith("SPEAKER"):
        return label.upper().replace(" ", "_")
    if index is not None:
        return f"SPEAKER_{index + 1:02d}"
    return label.upper() or "SPEAKER_01"


def remap_speaker_labels(turns: Sequence[SpeakerTurn]) -> list[SpeakerTurn]:
    order: list[str] = []
    mapped: dict[str, str] = {}
    remapped: list[SpeakerTurn] = []
    for turn in sorted(turns, key=lambda item: (item.start_time, item.end_time)):
        key = (turn.speaker or "").strip() or "unknown"
        if key not in mapped:
            mapped[key] = f"SPEAKER_{len(order) + 1:02d}"
            order.append(key)
        remapped.append(
            SpeakerTurn(start_time=turn.start_time, end_time=turn.end_time, speaker=mapped[key])
        )
    return remapped


def speaker_for_span(turns: Sequence[SpeakerTurn], start: float, end: float) -> str | None:
    if not turns:
        return None
    if end <= start:
        end = start + 0.01
    best: str | None = None
    best_overlap = 0.0
    nearest: str | None = None
    nearest_gap = 1e9
    mid = (start + end) / 2
    duration = max(end - start, 0.01)
    for turn in turns:
        overlap = min(end, turn.end_time) - max(start, turn.start_time)
        if overlap > best_overlap:
            best_overlap = overlap
            best = turn.speaker
        if turn.start_time <= mid <= turn.end_time:
            gap = 0.0
        else:
            gap = min(abs(mid - turn.start_time), abs(mid - turn.end_time))
        if gap < nearest_gap:
            nearest_gap = gap
            nearest = turn.speaker
    if best is not None and (best_overlap >= 0.08 or best_overlap / duration >= 0.35):
        return best
    if nearest_gap <= 0.8:
        return nearest
    return best


def format_timestamp(seconds: float) -> str:
    total = max(0, int(round(seconds)))
    minutes, secs = divmod(total, 60)
    hours, minutes = divmod(minutes, 60)
    if hours:
        return f"{hours:d}:{minutes:02d}:{secs:02d}"
    return f"{minutes:02d}:{secs:02d}"


def format_speaker_transcript(segments: Sequence[TranscriptSegment], fallback: str = "") -> str:
    if not segments:
        return (fallback or "").strip()
    lines: list[str] = []
    current: str | None = None
    started = 0.0
    parts: list[str] = []

    def flush() -> None:
        if not parts:
            return
        label = current or "SPEAKER"
        text = " ".join(part.strip() for part in parts if part.strip())
        if not text:
            return
        lines.append(f"{label} [{format_timestamp(started)}]: {text}")

    for segment in segments:
        speaker = (segment.speaker or "").strip() or "SPEAKER"
        if speaker != current and parts:
            flush()
            parts = []
        if not parts:
            current = speaker
            started = segment.start_time
        parts.append(segment.text)
    flush()
    return "\n".join(lines).strip() or (fallback or "").strip()
