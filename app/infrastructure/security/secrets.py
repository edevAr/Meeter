from __future__ import annotations

import os


def read_api_key(explicit: str | None = None) -> str:
    """API keys come from environment / settings, never from the database."""
    if explicit:
        return explicit.strip()
    for name in ("AI_API_KEY", "OPENAI_API_KEY"):
        value = os.environ.get(name, "").strip()
        if value:
            return value
    return ""


def mask_secret(value: str) -> str:
    if not value:
        return ""
    if len(value) <= 8:
        return "••••"
    return f"{value[:3]}••••{value[-2:]}"
