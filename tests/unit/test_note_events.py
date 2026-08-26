from __future__ import annotations

import asyncio

from app.application.services.note_events import NoteEventHub


async def test_hub_delivers_to_account_subscribers() -> None:
    hub = NoteEventHub()
    hub.bind(asyncio.get_running_loop())
    ana = hub.subscribe("ana")
    luis = hub.subscribe("luis")
    hub.publish(["ana"], {"op": "upsert", "id": "n1"})
    event = await asyncio.wait_for(ana.get(), timeout=1)
    assert event["id"] == "n1"
    assert luis.empty()
    hub.unsubscribe("ana", ana)
    hub.publish(["ana"], {"op": "delete", "id": "n1"})
    await asyncio.sleep(0)
    assert ana.empty()
