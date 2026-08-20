from __future__ import annotations

import logging

from app.domain.interfaces.ai import AIProvider
from app.domain.models.analysis import MeetingAnalysisResult
from app.infrastructure.ai.json_repair import AnalysisParseError, parse_analysis_payload
from app.infrastructure.ai.prompts import ANALYSIS_SYSTEM_PROMPT, build_user_prompt

logger = logging.getLogger(__name__)


class AIProviderError(RuntimeError):
    pass


class LLMAnalysisProvider(AIProvider):
    """OpenAI-compatible chat completions (OpenAI, Azure-compatible, Ollama, etc.)."""

    def __init__(
        self,
        api_key: str,
        model: str,
        base_url: str | None = None,
        provider_name: str = "openai",
        is_cloud: bool = True,
    ) -> None:
        self.api_key = api_key
        self.model = model
        self.base_url = base_url or None
        self.name = provider_name
        self.is_cloud = is_cloud

    async def analyze(self, transcript: str, title: str | None = None) -> MeetingAnalysisResult:
        if not (transcript or "").strip():
            return MeetingAnalysisResult(
                summary="The transcript is empty, so no analysis could be produced.",
                key_topics=[],
                decisions=[],
                action_items=[],
                participants=[],
            )
        if not self.api_key and self.name not in {"ollama"}:
            raise AIProviderError(
                "No AI API key configured. Set AI_API_KEY in .env or Settings. "
                "Keys are never stored in the database."
            )
        logger.info("AI analysis started")
        raw = await self._complete(transcript, title)
        try:
            result = parse_analysis_payload(raw)
        except AnalysisParseError:
            logger.info("AI analysis JSON invalid, retrying once")
            raw = await self._complete(
                transcript,
                title,
                extra_instruction="Your previous reply was not valid JSON. Reply with JSON only.",
            )
            try:
                result = parse_analysis_payload(raw)
            except AnalysisParseError as exc:
                raise AIProviderError("The AI provider returned invalid structured output") from exc
        logger.info("AI analysis completed")
        return result

    async def _complete(
        self,
        transcript: str,
        title: str | None,
        extra_instruction: str | None = None,
    ) -> str:
        try:
            from openai import AsyncOpenAI
        except ImportError as exc:
            raise AIProviderError("openai package is required for LLM analysis") from exc

        kwargs: dict = {"api_key": self.api_key or "ollama"}
        if self.base_url:
            kwargs["base_url"] = self.base_url
        client = AsyncOpenAI(**kwargs)
        user = build_user_prompt(transcript, title)
        if extra_instruction:
            user = extra_instruction + "\n\n" + user
        try:
            response = await client.chat.completions.create(
                model=self.model,
                temperature=0.1,
                response_format={"type": "json_object"},
                messages=[
                    {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
                    {"role": "user", "content": user},
                ],
            )
        except Exception:
            try:
                response = await client.chat.completions.create(
                    model=self.model,
                    temperature=0.1,
                    messages=[
                        {"role": "system", "content": ANALYSIS_SYSTEM_PROMPT},
                        {"role": "user", "content": user},
                    ],
                )
            except Exception as exc:
                raise AIProviderError("AI provider request failed") from exc
        choice = response.choices[0].message.content if response.choices else None
        return choice or ""
