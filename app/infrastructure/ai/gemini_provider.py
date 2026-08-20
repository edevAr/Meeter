from __future__ import annotations

import logging

import httpx

from app.domain.interfaces.ai import AIProvider
from app.domain.models.analysis import MeetingAnalysisResult
from app.infrastructure.ai.json_repair import AnalysisParseError, parse_analysis_payload
from app.infrastructure.ai.llm_provider import AIProviderError
from app.infrastructure.ai.prompts import ANALYSIS_SYSTEM_PROMPT, build_user_prompt

logger = logging.getLogger(__name__)


class GeminiAnalysisProvider(AIProvider):
    """Google Gemini free-tier chat (AI Studio key)."""

    name = "gemini"
    is_cloud = True

    def __init__(self, api_key: str, model: str = "gemini-2.0-flash") -> None:
        self.api_key = api_key
        self.model = model or "gemini-2.0-flash"

    async def analyze(self, transcript: str, title: str | None = None) -> MeetingAnalysisResult:
        if not (transcript or "").strip():
            return MeetingAnalysisResult(
                summary="The transcript is empty, so no analysis could be produced.",
                key_topics=[],
                decisions=[],
                action_items=[],
                participants=[],
            )
        if not self.api_key:
            raise AIProviderError("No Gemini API key configured.")
        logger.info("Gemini analysis started")
        raw = await self._complete(transcript, title)
        try:
            result = parse_analysis_payload(raw)
        except AnalysisParseError:
            raw = await self._complete(
                transcript,
                title,
                extra="Your previous reply was not valid JSON. Reply with JSON only.",
            )
            try:
                result = parse_analysis_payload(raw)
            except AnalysisParseError as exc:
                raise AIProviderError("The AI provider returned invalid structured output") from exc
        logger.info("Gemini analysis completed")
        return result

    async def _complete(self, transcript: str, title: str | None, extra: str = "") -> str:
        prompt = ANALYSIS_SYSTEM_PROMPT + "\n\n" + build_user_prompt(transcript, title)
        if extra:
            prompt = extra + "\n\n" + prompt
        url = (
            "https://generativelanguage.googleapis.com/v1beta/models/"
            f"{self.model}:generateContent"
        )
        payload = {
            "contents": [{"parts": [{"text": prompt}]}],
            "generationConfig": {"temperature": 0.2, "responseMimeType": "application/json"},
        }
        try:
            async with httpx.AsyncClient(timeout=60.0) as client:
                response = await client.post(url, params={"key": self.api_key}, json=payload)
                response.raise_for_status()
                data = response.json()
        except Exception as exc:
            raise AIProviderError("Gemini request failed") from exc
        candidates = data.get("candidates") or []
        parts = ((candidates[0] or {}).get("content") or {}).get("parts") or []
        text = "".join(str(part.get("text") or "") for part in parts)
        return text
