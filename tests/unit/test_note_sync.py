from __future__ import annotations

from datetime import datetime, timedelta, timezone

from app.application.services.auth_service import AuthService
from app.application.services.note_service import NoteService
from app.api.schemas import NoteSyncItem
from app.infrastructure.database.session import init_database, make_session_factory
from sqlalchemy import create_engine


def _svc(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'sync.db'}", connect_args={"check_same_thread": False}, future=True)
    init_database(engine)
    factory = make_session_factory(engine)
    auth = AuthService(factory)
    from app.infrastructure.database.repositories import SqlAlchemyUnitOfWork

    notes = NoteService(lambda: SqlAlchemyUnitOfWork(factory), auth)
    return auth, notes


def test_sync_creates_and_updates_last_write_wins(tmp_path) -> None:
    auth, notes = _svc(tmp_path)
    ana, _ = auth.register(email="ana@meeter.test", password="secret123", name="Ana")
    luis, _ = auth.register(email="luis@meeter.test", password="secret123", name="Luis")
    now = datetime.now(timezone.utc)
    created = notes.sync(
        ana.id,
        [
            NoteSyncItem(
                id="11111111-1111-4111-8111-111111111111",
                title="Offline",
                body="Desde el teléfono",
                updated_at=now,
                created_at=now,
            )
        ],
    )
    assert any(note.id == "11111111-1111-4111-8111-111111111111" for note in created)
    older = now - timedelta(minutes=5)
    notes.sync(
        ana.id,
        [
            NoteSyncItem(
                id="11111111-1111-4111-8111-111111111111",
                title="Viejo",
                body="No debe ganar",
                updated_at=older,
            )
        ],
    )
    board = notes.list_for_board(user_id=ana.id)
    assert board[0].title == "Offline"
    later = now + timedelta(minutes=2)
    notes.sync(
        ana.id,
        [
            NoteSyncItem(
                id="11111111-1111-4111-8111-111111111111",
                title="Web",
                body="Editada en el corcho",
                updated_at=later,
            )
        ],
    )
    board = notes.list_for_board(user_id=ana.id)
    assert board[0].title == "Web"
    stolen = notes.sync(
        luis.id,
        [
            NoteSyncItem(
                id="11111111-1111-4111-8111-111111111111",
                title="Robo",
                body="No",
                updated_at=later + timedelta(minutes=1),
            )
        ],
    )
    assert all(note.id != "11111111-1111-4111-8111-111111111111" for note in stolen)
    notes.sync(ana.id, [NoteSyncItem(id="11111111-1111-4111-8111-111111111111", deleted=True)])
    assert notes.list_for_board(user_id=ana.id) == []


def test_sync_archive_wins_over_future_created_at(tmp_path) -> None:
    auth, notes = _svc(tmp_path)
    ana, _ = auth.register(email="ana-archive@meeter.test", password="secret123", name="Ana")
    now = datetime.now(timezone.utc)
    future = now + timedelta(hours=2)
    nid = "22222222-2222-4222-8222-222222222222"
    notes.sync(
        ana.id,
        [
            NoteSyncItem(
                id=nid,
                title="Nota de voz",
                body="Hola",
                created_at=future,
                updated_at=now,
            )
        ],
    )
    later = now + timedelta(seconds=1)
    notes.sync(
        ana.id,
        [
            NoteSyncItem(
                id=nid,
                title="Nota de voz",
                body="Hola",
                archived=True,
                created_at=future,
                updated_at=later,
            )
        ],
    )
    board = notes.list_for_board(archived=False, user_id=ana.id)
    trash = notes.list_for_board(archived=True, user_id=ana.id)
    assert all(note.id != nid for note in board)
    assert any(note.id == nid and note.archived for note in trash)
