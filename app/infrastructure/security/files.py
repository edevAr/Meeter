from __future__ import annotations

import re
from pathlib import Path

ALLOWED_AUDIO_EXTENSIONS = {".wav", ".flac", ".mp3", ".m4a", ".ogg", ".webm"}
UNSAFE_NAME_CHARS = re.compile(r"[^A-Za-z0-9._-]+")


class FileValidationError(ValueError):
    pass


def sanitize_filename(name: str, fallback: str = "recording") -> str:
    cleaned = UNSAFE_NAME_CHARS.sub("_", name).strip("._")
    cleaned = cleaned[:80] or fallback
    if cleaned in {".", ".."}:
        return fallback
    return cleaned


def validate_audio_path(path: Path, max_bytes: int, must_exist: bool = True) -> Path:
    resolved = path.expanduser().resolve()
    suffix = resolved.suffix.lower()
    if suffix not in ALLOWED_AUDIO_EXTENSIONS:
        raise FileValidationError(f"Unsupported audio extension: {suffix}")
    if must_exist:
        if not resolved.is_file():
            raise FileValidationError("Audio file does not exist")
        size = resolved.stat().st_size
        if size <= 0:
            raise FileValidationError("Audio file is empty")
        if size > max_bytes:
            raise FileValidationError("Audio file exceeds maximum allowed size")
    return resolved


def safe_join(base: Path, *parts: str) -> Path:
    base_resolved = base.expanduser().resolve()
    candidate = base_resolved.joinpath(*parts).resolve()
    try:
        candidate.relative_to(base_resolved)
    except ValueError as exc:
        raise FileValidationError("Path traversal is not allowed") from exc
    return candidate


def delete_file_quietly(path: str | Path) -> None:
    file_path = Path(path)
    try:
        if file_path.is_file():
            file_path.unlink()
    except OSError:
        return
