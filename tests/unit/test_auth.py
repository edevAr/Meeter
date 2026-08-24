from __future__ import annotations

from app.application.services.auth_service import AuthError, AuthService
from app.infrastructure.database.session import init_database, make_session_factory
from app.infrastructure.security.passwords import hash_password, verify_password
from sqlalchemy import create_engine


def test_password_hash_roundtrip() -> None:
    stored = hash_password("secret123")
    assert stored != "secret123"
    assert verify_password("secret123", stored)
    assert not verify_password("other", stored)


def test_register_login_logout_and_reset(tmp_path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'auth.db'}", connect_args={"check_same_thread": False}, future=True)
    init_database(engine)
    auth = AuthService(make_session_factory(engine))
    user, token = auth.register(email="Ana@Meeter.test", password="secret123", name="Ana")
    assert user.email == "ana@meeter.test"
    assert auth.user_from_token(token) is not None
    logged, other = auth.login(email="ana@meeter.test", password="secret123")
    assert logged.id == user.id
    assert other != token
    try:
        auth.login(email="ana@meeter.test", password="nope")
        raise AssertionError("should fail")
    except AuthError as exc:
        assert exc.status_code == 401
    auth.logout(token)
    assert auth.user_from_token(token) is None
    code = auth.request_reset("ana@meeter.test")
    assert code and len(code) == 6
    auth.reset_password(email="ana@meeter.test", code=code, password="newpass12")
    assert auth.user_from_token(other) is None
    again, _fresh = auth.login(email="ana@meeter.test", password="newpass12")
    assert again.id == user.id
