from __future__ import annotations

from pathlib import Path


def test_placeholder() -> None:
    """Keeps the tests package importable on older pytest layouts."""
    assert Path(__file__).exists()
