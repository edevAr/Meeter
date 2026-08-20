from __future__ import annotations

from datetime import date, datetime, timedelta


def parse_due_date(value: str | None) -> date | None:
    if not value:
        return None
    text = value.strip()
    if not text:
        return None
    for fmt in ("%Y-%m-%d", "%Y/%m/%d", "%d/%m/%Y", "%d-%m-%Y"):
        try:
            return datetime.strptime(text, fmt).date()
        except ValueError:
            continue
    year = date.today().year
    for fmt in ("%b %d", "%B %d", "%b %d, %Y", "%B %d, %Y"):
        try:
            parsed = datetime.strptime(text, fmt)
            if "%Y" not in fmt:
                parsed = parsed.replace(year=year)
            return parsed.date()
        except ValueError:
            continue
    return None


def range_bounds(kind: str, today: date | None = None) -> tuple[date, date]:
    today = today or date.today()
    if kind == "week":
        start = today - timedelta(days=today.weekday())
        return start, start + timedelta(days=6)
    if kind == "month":
        start = today.replace(day=1)
        if start.month == 12:
            end = date(start.year + 1, 1, 1) - timedelta(days=1)
        else:
            end = date(start.year, start.month + 1, 1) - timedelta(days=1)
        return start, end
    return today, today


def in_range(due: date | None, start: date, end: date, *, include_undated: bool, include_overdue: bool) -> bool:
    if due is None:
        return include_undated
    if include_overdue and due < start:
        return True
    return start <= due <= end
