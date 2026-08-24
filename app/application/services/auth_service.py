from __future__ import annotations

from datetime import datetime, timedelta, timezone

from sqlalchemy import func, select
from sqlalchemy.orm import sessionmaker

from uuid import uuid4

from app.domain.models.user import User
from app.infrastructure.database.models import PasswordResetRow, SessionRow, UserRow
from app.infrastructure.security.passwords import (
    hash_password,
    hash_token,
    new_reset_code,
    new_session_token,
    verify_password,
)

SESSION_DAYS = 30
RESET_MINUTES = 30


class AuthError(Exception):
    def __init__(self, message: str, status_code: int = 400) -> None:
        super().__init__(message)
        self.message = message
        self.status_code = status_code


def normalize_email(email: str) -> str:
    return (email or "").strip().lower()


def _aware(dt: datetime | None) -> datetime:
    if dt is None:
        return datetime.now(timezone.utc)
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt


def _user_from_row(row: UserRow) -> User:
    return User(
        id=row.id,
        email=row.email,
        name=row.name or "",
        password_hash=row.password_hash,
        created_at=_aware(row.created_at),  # type: ignore[arg-type]
        updated_at=_aware(row.updated_at),  # type: ignore[arg-type]
    )


class AuthService:
    def __init__(self, session_factory: sessionmaker) -> None:
        self._session_factory = session_factory

    def register(self, *, email: str, password: str, name: str = "") -> tuple[User, str]:
        email = normalize_email(email)
        if "@" not in email or "." not in email.split("@")[-1]:
            raise AuthError("Escribe un correo válido.")
        if len(password) < 8:
            raise AuthError("La clave debe tener al menos 8 caracteres.")
        display = (name or "").strip() or email.split("@")[0]
        with self._session_factory() as session:
            exists = session.scalar(select(UserRow).where(UserRow.email == email))
            if exists:
                raise AuthError("Ya existe una cuenta con ese correo.")
            user = User(email=email, name=display, password_hash=hash_password(password))
            session.add(
                UserRow(
                    id=user.id,
                    email=user.email,
                    name=user.name,
                    password_hash=user.password_hash,
                    created_at=user.created_at,
                    updated_at=user.updated_at,
                )
            )
            session.flush()
            token = self._create_session(session, user.id)
            session.commit()
            return user, token

    def login(self, *, email: str, password: str) -> tuple[User, str]:
        email = normalize_email(email)
        with self._session_factory() as session:
            row = session.scalar(select(UserRow).where(UserRow.email == email))
            if row is None or not verify_password(password, row.password_hash):
                raise AuthError("Correo o clave incorrectos.", 401)
            user = _user_from_row(row)
            token = self._create_session(session, user.id)
            session.commit()
            return user, token

    def logout(self, token: str | None) -> None:
        if not token:
            return
        with self._session_factory() as session:
            row = session.scalar(select(SessionRow).where(SessionRow.token_hash == hash_token(token)))
            if row is not None:
                session.delete(row)
                session.commit()

    def user_from_token(self, token: str | None) -> User | None:
        if not token:
            return None
        with self._session_factory() as session:
            row = session.scalar(select(SessionRow).where(SessionRow.token_hash == hash_token(token)))
            if row is None:
                return None
            if _aware(row.expires_at) <= datetime.now(timezone.utc):  # type: ignore[arg-type]
                session.delete(row)
                session.commit()
                return None
            user_row = session.get(UserRow, row.user_id)
            return _user_from_row(user_row) if user_row else None

    def users_by_ids(self, user_ids: list[str]) -> dict[str, User]:
        ids = [item for item in {uid for uid in user_ids if uid}]
        if not ids:
            return {}
        with self._session_factory() as session:
            rows = session.scalars(select(UserRow).where(UserRow.id.in_(ids)))
            return {row.id: _user_from_row(row) for row in rows}

    def find_recipient(self, identifier: str) -> User:
        raw = (identifier or "").strip()
        if not raw:
            raise AuthError("Escribe un nombre o correo.")
        with self._session_factory() as session:
            if "@" in raw:
                row = session.scalar(select(UserRow).where(UserRow.email == normalize_email(raw)))
                if row is None:
                    raise AuthError("No hay una cuenta con ese correo.")
                return _user_from_row(row)
            matches = list(
                session.scalars(select(UserRow).where(func.lower(UserRow.name) == raw.lower()))
            )
            if len(matches) == 1:
                return _user_from_row(matches[0])
            if len(matches) > 1:
                raise AuthError("Hay varias cuentas con ese nombre. Usa el correo.")
            raise AuthError("No hay una cuenta con ese nombre o correo.")

    def request_reset(self, email: str) -> str | None:
        email = normalize_email(email)
        with self._session_factory() as session:
            user = session.scalar(select(UserRow).where(UserRow.email == email))
            if user is None:
                return None
            old = session.scalars(select(PasswordResetRow).where(PasswordResetRow.user_id == user.id))
            for item in old:
                session.delete(item)
            code = new_reset_code()
            session.add(
                PasswordResetRow(
                    id=str(uuid4()),
                    user_id=user.id,
                    code_hash=hash_token(code),
                    expires_at=datetime.now(timezone.utc) + timedelta(minutes=RESET_MINUTES),
                    created_at=datetime.now(timezone.utc),
                )
            )
            session.flush()
            session.commit()
            return code

    def reset_password(self, *, email: str, code: str, password: str) -> None:
        email = normalize_email(email)
        if len(password) < 8:
            raise AuthError("La clave debe tener al menos 8 caracteres.")
        with self._session_factory() as session:
            user = session.scalar(select(UserRow).where(UserRow.email == email))
            if user is None:
                raise AuthError("Código inválido o vencido.", 400)
            reset = session.scalar(
                select(PasswordResetRow).where(
                    PasswordResetRow.user_id == user.id,
                    PasswordResetRow.code_hash == hash_token((code or "").strip()),
                )
            )
            if reset is None or _aware(reset.expires_at) <= datetime.now(timezone.utc):  # type: ignore[arg-type]
                raise AuthError("Código inválido o vencido.", 400)
            user.password_hash = hash_password(password)
            user.updated_at = datetime.now(timezone.utc)
            sessions = session.scalars(select(SessionRow).where(SessionRow.user_id == user.id))
            for item in sessions:
                session.delete(item)
            session.delete(reset)
            session.commit()

    def _create_session(self, session, user_id: str) -> str:
        token = new_session_token()
        session.add(
            SessionRow(
                id=str(uuid4()),
                user_id=user_id,
                token_hash=hash_token(token),
                expires_at=datetime.now(timezone.utc) + timedelta(days=SESSION_DAYS),
                created_at=datetime.now(timezone.utc),
            )
        )
        return token
