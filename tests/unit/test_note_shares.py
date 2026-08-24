from __future__ import annotations

from app.application.services.auth_service import AuthService
from app.application.services.note_service import NoteAccessError, NoteService
from app.infrastructure.database.session import init_database, make_session_factory
from sqlalchemy import create_engine


def _auth_and_notes(tmp_path):
    engine = create_engine(f"sqlite:///{tmp_path / 'share.db'}", connect_args={"check_same_thread": False}, future=True)
    init_database(engine)
    factory = make_session_factory(engine)
    auth = AuthService(factory)
    from app.infrastructure.database.repositories import SqlAlchemyUnitOfWork

    notes = NoteService(lambda: SqlAlchemyUnitOfWork(factory), auth)
    return auth, notes


def test_share_note_by_email_and_name(tmp_path) -> None:
    auth, notes = _auth_and_notes(tmp_path)
    ana, _ = auth.register(email="ana@meeter.test", password="secret123", name="Ana")
    luis, _ = auth.register(email="luis@meeter.test", password="secret123", name="Luis")
    note = notes.create(title="Idea", body="Compartir", user_id=ana.id)

    shared = notes.share(note.id, ana.id, identifier="luis@meeter.test", can_read=True, can_write=False)
    assert shared.email == "luis@meeter.test"
    assert shared.can_read is True
    assert shared.can_write is False

    board = notes.list_for_board(user_id=luis.id)
    assert len(board) == 1
    assert board[0].id == note.id
    assert board[0].access == "read"
    assert board[0].owner_name == "Ana"

    again = notes.share(note.id, ana.id, identifier="Luis", can_read=True, can_write=True)
    assert again.id == shared.id
    assert again.can_write is True

    board = notes.list_for_board(user_id=luis.id)
    assert board[0].access == "write"
    assert notes.access_of(note.id, luis.id) == "write"


def test_share_rejects_missing_user_and_self(tmp_path) -> None:
    auth, notes = _auth_and_notes(tmp_path)
    ana, _ = auth.register(email="ana@meeter.test", password="secret123", name="Ana")
    note = notes.create(title="Privada", user_id=ana.id)
    try:
        notes.share(note.id, ana.id, identifier="nadie@meeter.test", can_read=True)
        raise AssertionError("should fail")
    except NoteAccessError as exc:
        assert "correo" in exc.message
    try:
        notes.share(note.id, ana.id, identifier="ana@meeter.test", can_read=True)
        raise AssertionError("should fail")
    except NoteAccessError as exc:
        assert exc.status_code == 400


def test_reader_cannot_list_shares(tmp_path) -> None:
    auth, notes = _auth_and_notes(tmp_path)
    ana, _ = auth.register(email="ana@meeter.test", password="secret123", name="Ana")
    luis, _ = auth.register(email="luis@meeter.test", password="secret123", name="Luis")
    note = notes.create(title="Idea", user_id=ana.id)
    notes.share(note.id, ana.id, identifier="luis@meeter.test", can_read=True)
    try:
        notes.list_shares(note.id, luis.id)
        raise AssertionError("should fail")
    except NoteAccessError as exc:
        assert exc.status_code == 403
    people = notes.list_shares(note.id, ana.id)
    assert len(people) == 1
    notes.unshare(note.id, people[0].id, ana.id)
    assert notes.list_for_board(user_id=luis.id) == []
