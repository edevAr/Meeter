from __future__ import annotations

from functools import lru_cache
from pathlib import Path

from pydantic import Field, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

PROJECT_ROOT = Path(__file__).resolve().parents[2]


class Settings(BaseSettings):
    model_config = SettingsConfigDict(
        env_file=str(PROJECT_ROOT / ".env"),
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    ai_provider: str = "openai"
    ai_api_key: str = ""
    ai_model: str = "gpt-4o-mini"
    ai_base_url: str = ""

    transcription_provider: str = "whisper"
    whisper_model: str = "base"
    openai_transcription_model: str = "whisper-1"
    allow_cloud_transcription: bool = False

    diarization_provider: str = "clustering"
    pyannote_model: str = "pyannote/speaker-diarization-3.1"
    hf_token: str = ""

    database_url: str = "sqlite:///./data/app.db"

    recordings_path: Path = Path("./data/recordings")
    transcripts_path: Path = Path("./data/transcripts")
    exports_path: Path = Path("./data/exports")

    audio_sample_rate: int = 16000
    audio_channels: int = 1
    audio_sample_width: int = 2
    default_language: str = "auto"

    max_recording_bytes: int = 500 * 1024 * 1024
    log_level: str = "INFO"
    host: str = "0.0.0.0"
    port: int = 8000

    default_audio_source: str = "microphone"

    @field_validator("recordings_path", "transcripts_path", "exports_path", mode="before")
    @classmethod
    def _resolve_path(cls, value: str | Path) -> Path:
        path = Path(value)
        if not path.is_absolute():
            path = PROJECT_ROOT / path
        return path

    @field_validator("database_url", mode="before")
    @classmethod
    def _resolve_sqlite(cls, value: str) -> str:
        prefix = "sqlite:///"
        if value.startswith(prefix) and not value.startswith("sqlite:////"):
            rest = value[len(prefix) :]
            if rest.startswith("./") or not rest.startswith("/"):
                resolved = (PROJECT_ROOT / rest.lstrip("./")).resolve()
                return f"sqlite:///{resolved}"
        return value

    def ensure_directories(self) -> None:
        for path in (self.recordings_path, self.transcripts_path, self.exports_path):
            path.mkdir(parents=True, exist_ok=True)
        self.recordings_path.parent.mkdir(parents=True, exist_ok=True)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.ensure_directories()
    return settings
