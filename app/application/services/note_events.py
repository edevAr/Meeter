from __future__ import annotations

import asyncio
from collections import defaultdict


class NoteEventHub:
    """In-memory SSE fan-out for note changes on the same user account."""

    def __init__(self) -> None:
        self._subs: dict[str, list[asyncio.Queue[dict]]] = defaultdict(list)
        self._loop: asyncio.AbstractEventLoop | None = None

    def bind(self, loop: asyncio.AbstractEventLoop) -> None:
        self._loop = loop

    def subscribe(self, user_id: str) -> asyncio.Queue[dict]:
        queue: asyncio.Queue[dict] = asyncio.Queue(maxsize=100)
        self._subs[user_id].append(queue)
        return queue

    def unsubscribe(self, user_id: str, queue: asyncio.Queue[dict]) -> None:
        buckets = self._subs.get(user_id)
        if not buckets:
            return
        if queue in buckets:
            buckets.remove(queue)
        if not buckets:
            self._subs.pop(user_id, None)

    def publish(self, user_ids: list[str], event: dict) -> None:
        unique = [user_id for user_id in dict.fromkeys(user_ids) if user_id]
        if not unique:
            return
        loop = self._loop
        if loop is None or not loop.is_running():
            self._put(unique, event)
            return
        loop.call_soon_threadsafe(self._put, unique, event)

    def _put(self, user_ids: list[str], event: dict) -> None:
        for user_id in user_ids:
            for queue in list(self._subs.get(user_id, [])):
                try:
                    queue.put_nowait(event)
                except asyncio.QueueFull:
                    try:
                        queue.get_nowait()
                    except asyncio.QueueEmpty:
                        pass
                    try:
                        queue.put_nowait(event)
                    except asyncio.QueueFull:
                        pass
