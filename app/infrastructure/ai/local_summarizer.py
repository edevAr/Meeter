from __future__ import annotations

import re
from collections import Counter

from app.domain.interfaces.ai import AIProvider
from app.domain.models.analysis import LLMActionItem, MeetingAnalysisResult
from app.domain.models.enums import ActionItemPriority

_SENTENCE_RE = re.compile(r"(?<=[.!?¿¡])\s+|\n+")
_WORD_RE = re.compile(r"[a-záéíóúñü0-9]+", re.IGNORECASE)

_STOP = {
    "a", "al", "algo", "ante", "como", "con", "contra", "de", "del", "desde",
    "donde", "el", "ella", "ellos", "en", "entonces", "entre", "era", "es",
    "esa", "ese", "eso", "esta", "este", "esto", "fue", "ha", "hay", "la",
    "las", "le", "les", "lo", "los", "me", "mi", "muy", "no", "nos", "o",
    "para", "pero", "por", "porque", "que", "se", "si", "sin", "sobre", "su",
    "sus", "también", "te", "un", "una", "uno", "unos", "y", "ya", "the",
    "and", "or", "to", "of", "in", "on", "for", "we", "you", "it", "is",
    "are", "was", "be", "this", "that", "with", "as", "at",
}

_ACTION_HINTS = (
    "hay que", "tenemos que", "tiene que", "debo", "debes", "vamos a", "voy a",
    "acordamos", "quedamos", "pendiente", "enviar", "llamar", "revisar",
    "entregar", "preparar", "agendar", "hacer", "need to", "have to", "let's",
    "we will", "we should", "action", "follow up", "seguir",
)

_DECISION_HINTS = (
    "acordamos", "decidimos", "queda", "quedó", "se decide", "aprobamos",
    "vamos con", "cerramos", "decided", "agreed", "we'll go",
)


class LocalCallSummarizer(AIProvider):
    """Free on-device summarizer used when no cloud LLM key is configured."""

    name = "local-free"
    is_cloud = False

    async def analyze(self, transcript: str, title: str | None = None) -> MeetingAnalysisResult:
        text = (transcript or "").strip()
        if not text:
            return MeetingAnalysisResult(
                summary="No se capturó texto de la llamada. Puedes editar esta nota con lo que recuerdes.",
                key_topics=[],
                decisions=[],
                action_items=[],
                participants=[],
            )
        sentences = [part.strip(" •-\t") for part in _SENTENCE_RE.split(text) if part.strip()]
        if not sentences:
            sentences = [text]
        ranked = _rank_sentences(sentences)
        summary = " ".join(ranked[:3]).strip()
        topics = [item if len(item) < 90 else item[:87].rstrip() + "…" for item in ranked[:5]]
        decisions = [item for item in sentences if _looks_like(item, _DECISION_HINTS)][:5]
        actions = [item for item in sentences if _looks_like(item, _ACTION_HINTS)][:6]
        return MeetingAnalysisResult(
            summary=summary or text[:280],
            key_topics=topics,
            decisions=decisions,
            action_items=[
                LLMActionItem(task=item, priority=ActionItemPriority.MEDIUM) for item in actions
            ],
            participants=[],
        )


def _looks_like(sentence: str, hints: tuple[str, ...]) -> bool:
    lowered = sentence.lower()
    return any(hint in lowered for hint in hints)


def _rank_sentences(sentences: list[str]) -> list[str]:
    words: list[str] = []
    for sentence in sentences:
        words.extend(
            token
            for token in _WORD_RE.findall(sentence.lower())
            if token not in _STOP and len(token) > 2
        )
    freq = Counter(words)
    scored: list[tuple[float, int, str]] = []
    for index, sentence in enumerate(sentences):
        tokens = [token for token in _WORD_RE.findall(sentence.lower()) if token not in _STOP]
        if not tokens:
            continue
        score = sum(freq[token] for token in tokens) / len(tokens)
        if _looks_like(sentence, _ACTION_HINTS + _DECISION_HINTS):
            score += 1.4
        scored.append((score, -index, sentence))
    scored.sort(reverse=True)
    ordered = [item[2] for item in scored]
    return ordered or sentences
