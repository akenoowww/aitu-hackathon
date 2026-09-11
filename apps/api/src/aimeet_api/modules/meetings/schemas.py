import uuid
from datetime import UTC, datetime
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_serializer, field_validator


class MeetingCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(min_length=1, max_length=200)
    language: Literal["auto", "ru", "kk", "en"] = "auto"
    transcript: str = Field(min_length=1, max_length=200_000)

    @field_validator("title", "transcript")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Must contain non-whitespace characters")
        return value

    @field_validator("title")
    @classmethod
    def normalize_title(cls, value: str) -> str:
        return value.strip()


class MeetingSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    title: str
    language: Literal["auto", "ru", "kk", "en"]
    status: Literal["draft"]
    source_type: Literal["text"]
    created_at: datetime
    updated_at: datetime
    transcript_length: int

    @field_serializer("created_at", "updated_at")
    def serialize_datetime(self, value: datetime) -> str:
        # SQLite test storage drops tzinfo; production stores TIMESTAMPTZ.
        return value.replace(tzinfo=UTC).isoformat() if value.tzinfo is None else value.isoformat()


class MeetingDetail(MeetingSummary):
    transcript: str


class MeetingList(BaseModel):
    items: list[MeetingSummary]
    total: int
    limit: int
    offset: int
