from __future__ import annotations

from fastapi import Depends

from app.container import AppContainer, build_container

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
