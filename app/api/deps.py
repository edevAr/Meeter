from __future__ import annotations

from fastapi import Depends, Header, HTTPException

from app.container import AppContainer, build_container
from app.domain.models.user import User

_container: AppContainer | None = None


def get_container() -> AppContainer:
    global _container
    if _container is None:
        _container = build_container()
    return _container


def set_container(container: AppContainer) -> None:
    global _container
    _container = container


def get_token(authorization: str | None = Header(default=None)) -> str | None:
    if not authorization:
        return None
    scheme, _, value = authorization.partition(" ")
    if scheme.lower() != "bearer" or not value:
        return None
    return value.strip()


def get_current_user(
    token: str | None = Depends(get_token),
    container: AppContainer = Depends(get_container),
) -> User:
    user = container.auth.user_from_token(token)
    if user is None:
        raise HTTPException(status_code=401, detail="Inicia sesión para continuar.")
    return user


ContainerDep = Depends(get_container)

_container: AppContainer | None = None


def get_container() -> AppContainer:
    global _container
    if _container is None:
        _container = build_container()
    return _container


def set_container(container: AppContainer) -> None:
    global _container
    _container = container


ContainerDep = Depends(get_container)
