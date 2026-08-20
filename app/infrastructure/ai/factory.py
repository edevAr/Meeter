from __future__ import annotations

import logging

from app.config.settings import Settings
from app.domain.interfaces.ai import AIProvider
from app.domain.models.analysis import MeetingAnalysisResult
from app.infrastructure.ai.gemini_provider import GeminiAnalysisProvider
from app.infrastructure.ai.llm_provider import LLMAnalysisProvider
from app.infrastructure.ai.local_summarizer import LocalCallSummarizer

logger = logging.getLogger(__name__)

GROQ_URL = "https://api.groq.com/openai/v1"
GROQ_MODEL = "llama-3.1-8b-instant"


class FallbackAIProvider(AIProvider):
    """Tries a free/cloud LLM, then the on-device summarizer."""

    def __init__(self, primary: AIProvider | None, fallback: AIProvider) -> None:
        self.primary = primary
        self.fallback = fallback
        self.name = primary.name if primary is not None else fallback.name
        self.is_cloud = primary.is_cloud if primary is not None else fallback.is_cloud

    async def analyze(self, transcript: str, title: str | None = None) -> MeetingAnalysisResult:
        if self.primary is not None:
            try:
                return await self.primary.analyze(transcript, title)
            except Exception:
                logger.info("Cloud AI unavailable, using local free summarizer")
        return await self.fallback.analyze(transcript, title)


def create_ai_provider(settings: Settings) -> AIProvider:
    local = LocalCallSummarizer()
    name = (settings.ai_provider or "").strip().lower() or "openai"
    key = (settings.ai_api_key or "").strip()
    model = (settings.ai_model or "").strip()
    base_url = (settings.ai_base_url or "").strip() or None

    if key.startswith("gsk_") and name in {"openai", "compatible", ""}:
        name = "groq"
    if key.startswith("AIza") and name in {"openai", "compatible", ""}:
        name = "gemini"

    if name in {"local", "free", "extractive"}:
        return local

    if name in {"groq", "llama"}:
        base_url = base_url or GROQ_URL
        if not model or model.startswith("gpt-"):
            model = GROQ_MODEL
        primary = LLMAnalysisProvider(
            api_key=key,
            model=model,
            base_url=base_url,
            provider_name="groq",
            is_cloud=True,
        )
        return FallbackAIProvider(primary if key else None, local)

    if name in {"gemini", "google"}:
        if not model or model.startswith("gpt-"):
            model = "gemini-2.0-flash"
        primary = GeminiAnalysisProvider(api_key=key, model=model)
        return FallbackAIProvider(primary if key else None, local)

    if name == "ollama" and not base_url:
        base_url = "http://127.0.0.1:11434/v1"
    is_cloud = name not in {"ollama", "local"}
    if is_cloud and not key:
        return local
    primary = LLMAnalysisProvider(
        api_key=key,
        model=model or "gpt-4o-mini",
        base_url=base_url,
        provider_name=name,
        is_cloud=is_cloud,
    )
    return FallbackAIProvider(primary, local)
