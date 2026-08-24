from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException

from app.api.deps import get_container, get_current_user, get_token
from app.api.schemas import (
    ForgotPasswordIn,
    ForgotPasswordOut,
    LoginIn,
    RegisterIn,
    ResetPasswordIn,
    SessionOut,
    UserOut,
)
from app.application.services.auth_service import AuthError
from app.container import AppContainer
from app.domain.models.user import User

router = APIRouter(prefix="/api/auth", tags=["auth"])


def _session_out(user: User, token: str) -> SessionOut:
    return SessionOut(token=token, user=UserOut(id=user.id, email=user.email, name=user.name))


@router.post("/register", response_model=SessionOut, status_code=201)
def register(payload: RegisterIn, container: AppContainer = Depends(get_container)) -> SessionOut:
    try:
        user, token = container.auth.register(
            email=payload.email,
            password=payload.password,
            name=payload.name,
        )
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return _session_out(user, token)


@router.post("/login", response_model=SessionOut)
def login(payload: LoginIn, container: AppContainer = Depends(get_container)) -> SessionOut:
    try:
        user, token = container.auth.login(email=payload.email, password=payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return _session_out(user, token)


@router.post("/logout")
def logout(
    container: AppContainer = Depends(get_container),
    token: str | None = Depends(get_token),
) -> dict[str, str]:
    container.auth.logout(token)
    return {"detail": "ok"}


@router.get("/me", response_model=UserOut)
def me(user: User = Depends(get_current_user)) -> UserOut:
    return UserOut(id=user.id, email=user.email, name=user.name)


@router.post("/forgot-password", response_model=ForgotPasswordOut)
def forgot_password(
    payload: ForgotPasswordIn,
    container: AppContainer = Depends(get_container),
) -> ForgotPasswordOut:
    code = container.auth.request_reset(payload.email)
    return ForgotPasswordOut(
        detail="Si el correo existe, te dimos un código para cambiar la clave.",
        reset_code=code,
    )


@router.post("/reset-password")
def reset_password(
    payload: ResetPasswordIn,
    container: AppContainer = Depends(get_container),
) -> dict[str, str]:
    try:
        container.auth.reset_password(email=payload.email, code=payload.code, password=payload.password)
    except AuthError as exc:
        raise HTTPException(status_code=exc.status_code, detail=exc.message) from exc
    return {"detail": "Clave actualizada. Ya puedes entrar."}
