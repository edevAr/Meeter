from __future__ import annotations

from app.domain.models.analysis import MeetingAnalysisResult


def format_call_note(result: MeetingAnalysisResult, transcript: str = "") -> tuple[str, str]:
    summary = (result.summary or "").strip() or "Resumen de la llamada."
    first = summary.split(".")[0].strip()
    title = first if 12 <= len(first) <= 72 else "Notas de la llamada"
    blocks = [summary]
    topics = [item.strip() for item in result.key_topics if item and item.strip()]
    if topics:
        blocks.append("Puntos clave\n" + "\n".join(f"• {item}" for item in topics[:8]))
    decisions = [item.strip() for item in result.decisions if item and item.strip()]
    if decisions:
        blocks.append("Decisiones\n" + "\n".join(f"• {item}" for item in decisions[:6]))
    actions: list[str] = []
    for item in result.action_items[:8]:
        task = (item.task or "").strip()
        if not task:
            continue
        extra = []
        if item.owner:
            extra.append(str(item.owner))
        if item.due_date:
            extra.append(str(item.due_date))
        actions.append(f"• {task}" + (f" ({', '.join(extra)})" if extra else ""))
    if actions:
        blocks.append("Pendientes\n" + "\n".join(actions))
    full = (transcript or "").strip()
    if full:
        blocks.append("Transcripción\n" + full)
    return title, "\n\n".join(blocks)
