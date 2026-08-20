from __future__ import annotations

import json
import re
from typing import Any

from pydantic import ValidationError

from app.domain.models.analysis import MeetingAnalysisResult


class AnalysisParseError(ValueError):
    pass


_FENCE_RE = re.compile(r"```(?:json)?\s*(.*?)\s*```", re.DOTALL | re.IGNORECASE)


def extract_json_object(raw: str) -> dict[str, Any]:
    text = (raw or "").strip()
    if not text:
        raise AnalysisParseError("Empty model response")
    fenced = _FENCE_RE.search(text)
    if fenced:
        text = fenced.group(1).strip()
    start = text.find("{")
    end = text.rfind("}")
    if start == -1 or end == -1 or end <= start:
        raise AnalysisParseError("No JSON object in model response")
    snippet = text[start : end + 1]
    try:
        data = json.loads(snippet)
    except json.JSONDecodeError:
        repaired = _repair_json(snippet)
        try:
            data = json.loads(repaired)
        except json.JSONDecodeError as exc:
            raise AnalysisParseError("Invalid JSON in model response") from exc
    if not isinstance(data, dict):
        raise AnalysisParseError("JSON root must be an object")
    return data


def _repair_json(snippet: str) -> str:
    repaired = snippet.replace("\ufeff", "")
    repaired = re.sub(r",\s*}", "}", repaired)
    repaired = re.sub(r",\s*]", "]", repaired)
    repaired = repaired.replace("'", '"')
    return repaired


def parse_analysis_payload(raw: str) -> MeetingAnalysisResult:
    data = extract_json_object(raw)
    try:
        return MeetingAnalysisResult.model_validate(data)
    except ValidationError as exc:
        raise AnalysisParseError("Analysis JSON failed schema validation") from exc
