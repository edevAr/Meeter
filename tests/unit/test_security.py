from __future__ import annotations

from pathlib import Path

import pytest

from app.infrastructure.ai.json_repair import AnalysisParseError, parse_analysis_payload
from app.infrastructure.security.files import FileValidationError, safe_join, sanitize_filename, validate_audio_path


def test_sanitize_filename() -> None:
    assert ".." not in sanitize_filename("../etc/passwd")
    assert sanitize_filename("Meeting: Q3 / Plan?") == "Meeting_Q3_Plan"


def test_safe_join_blocks_traversal(tmp_path: Path) -> None:
    with pytest.raises(FileValidationError):
        safe_join(tmp_path, "..", "outside.wav")
    inside = safe_join(tmp_path, "ok.wav")
    assert inside.parent == tmp_path.resolve()


def test_validate_extension(tmp_path: Path) -> None:
    bad = tmp_path / "notes.exe"
    bad.write_bytes(b"nope")
    with pytest.raises(FileValidationError):
        validate_audio_path(bad, 1000)


def test_parse_fenced_and_repaired_json() -> None:
    raw = """```json
    {"summary": "Ok", "key_topics": ["A",], "decisions": [], "action_items": []}
    ```"""
    result = parse_analysis_payload(raw)
    assert result.summary == "Ok"
    assert result.key_topics == ["A"]


def test_parse_strips_qwen_think_blocks() -> None:
    raw = "<think>razonando</think>\n{\"summary\": \"Ok\", \"key_topics\": [], \"decisions\": [], \"action_items\": []}"
    result = parse_analysis_payload(raw)
    assert result.summary == "Ok"


def test_parse_rejects_empty() -> None:
    with pytest.raises(AnalysisParseError):
        parse_analysis_payload("")
