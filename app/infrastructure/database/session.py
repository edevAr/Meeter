from __future__ import annotations

from collections.abc import Callable
from pathlib import Path

from sqlalchemy import create_engine, event
from sqlalchemy.engine import Engine
from sqlalchemy.orm import Session, sessionmaker

from app.config.settings import Settings
from app.infrastructure.database.base import Base
from app.infrastructure.database import models as _models  # noqa: F401


def _sqlite_connect_args(url: str) -> dict:
    if url.startswith("sqlite"):
        return {"check_same_thread": False}
    return {}


@event.listens_for(Engine, "connect")
def _set_sqlite_pragma(dbapi_connection, connection_record) -> None:  # type: ignore[no-untyped-def]
    module = getattr(dbapi_connection, "__class__", type("x", (), {})).__module__
    if "sqlite" in module:
        cursor = dbapi_connection.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()


def create_engine_from_settings(settings: Settings) -> Engine:
    url = settings.database_url
    if url.startswith("sqlite:///"):
        db_path = Path(url.replace("sqlite:///", "", 1))
        db_path.parent.mkdir(parents=True, exist_ok=True)
    engine = create_engine(
        url,
        connect_args=_sqlite_connect_args(url),
        future=True,
        pool_pre_ping=True,
    )
    return engine


def init_database(engine: Engine) -> None:
    Base.metadata.create_all(engine)
    _ensure_note_layout_columns(engine)


def _ensure_note_layout_columns(engine: Engine) -> None:
    if engine.dialect.name != "sqlite":
        return
    with engine.begin() as conn:
        existing = {
            row[1]
            for row in conn.exec_driver_sql("PRAGMA table_info(notes)").fetchall()
        }
        if not existing:
            return
        alters = {
            "priority": "INTEGER DEFAULT 3",
            "pos_x": "FLOAT DEFAULT 72",
            "pos_y": "FLOAT DEFAULT 72",
            "rotation": "FLOAT DEFAULT -1.5",
            "width": "FLOAT DEFAULT 248",
            "height": "FLOAT DEFAULT 280",
            "reminder_at": "DATETIME",
            "alarm_tone": "VARCHAR(32) DEFAULT 'classic'",
            "reminder_silenced": "BOOLEAN DEFAULT 0",
        }
        for name, ddl in alters.items():
            if name not in existing:
                conn.exec_driver_sql(f"ALTER TABLE notes ADD COLUMN {name} {ddl}")


def make_session_factory(engine: Engine) -> sessionmaker[Session]:
    return sessionmaker(bind=engine, expire_on_commit=False, class_=Session, future=True)


SessionFactory = Callable[[], Session]
