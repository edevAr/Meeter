from __future__ import annotations

import logging
import re
from logging import Filter, LogRecord


class SensitiveDataFilter(Filter):
    _secret_pattern = re.compile(
        r"(api[_-]?key|token|secret|password|authorization)\s*[:=]\s*\S+",
        re.IGNORECASE,
    )

    def filter(self, record: LogRecord) -> bool:
        message = record.getMessage()
        if self._secret_pattern.search(message):
            record.msg = self._secret_pattern.sub(r"\1=***", str(record.msg))
            record.args = ()
        lowered = message.lower()
        blocked = ("transcript text", "transcription text", "api_key", "bearer ")
        if any(token in lowered for token in blocked) and len(message) > 200:
            record.msg = "Sensitive log record redacted"
            record.args = ()
        return True


def setup_logging(level: str = "INFO") -> None:
    root = logging.getLogger()
    if root.handlers:
        for handler in root.handlers:
            handler.addFilter(SensitiveDataFilter())
        root.setLevel(level.upper())
        return
    logging.basicConfig(
        level=level.upper(),
        format="%(asctime)s %(levelname)s %(name)s %(message)s",
    )
    for handler in logging.getLogger().handlers:
        handler.addFilter(SensitiveDataFilter())
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("openai").setLevel(logging.WARNING)
    logging.getLogger("sqlalchemy.engine").setLevel(logging.WARNING)
