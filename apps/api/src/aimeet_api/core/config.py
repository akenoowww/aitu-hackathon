from typing import Literal
from urllib.parse import urlsplit

from pydantic import Field, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=None, extra="ignore")

    app_env: Literal["development", "production"] = "development"
    database_url: str = "postgresql+psycopg://aimeet@localhost:5432/aimeet"
    cookie_secure: bool = False
    cookie_name: str = "aimeet_session"
    allowed_origins: str = "http://localhost:8080"
    session_ttl_seconds: int = Field(default=43_200, ge=300, le=604_800)
    login_attempt_limit: int = Field(default=10, ge=1, le=100)
    login_ip_attempt_limit: int = Field(default=30, ge=1, le=1000)
    login_window_seconds: int = Field(default=900, ge=60, le=3600)
    max_request_bytes: int = Field(default=1_100_000, ge=1024, le=10_000_000)

    @property
    def origins(self) -> list[str]:
        return [origin.strip().rstrip("/") for origin in self.allowed_origins.split(",")]

    @model_validator(mode="after")
    def validate_deployment(self) -> "Settings":
        if not self.origins or any(not origin for origin in self.origins):
            raise ValueError("ALLOWED_ORIGINS must contain explicit origins")
        for origin in self.origins:
            parsed = urlsplit(origin)
            if (
                parsed.scheme not in {"http", "https"}
                or not parsed.netloc
                or parsed.path
                or parsed.query
                or parsed.fragment
                or parsed.username
                or "*" in origin
            ):
                raise ValueError("ALLOWED_ORIGINS must contain exact HTTP(S) origins")
        if self.app_env == "production":
            if not self.cookie_secure:
                raise ValueError("Production requires COOKIE_SECURE=true")
            if any(not origin.startswith("https://") for origin in self.origins):
                raise ValueError("Production requires HTTPS ALLOWED_ORIGINS")
            if not self.database_url.startswith("postgresql+psycopg://"):
                raise ValueError("Production requires PostgreSQL with psycopg")
        return self
