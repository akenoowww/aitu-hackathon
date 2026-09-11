import uuid
from datetime import date
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator

Kind = Literal['task', 'decision', 'topic', 'question', 'risk']
Status = Literal['todo', 'doing', 'blocked', 'done', 'dismissed']
Priority = Literal['unspecified', 'low', 'medium', 'high']


class CardInput(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Kind = 'task'
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(default='', max_length=4000)
    assignee: str | None = Field(default=None, max_length=200)
    due_date: date | None = None
    due_text: str | None = Field(default=None, max_length=200)
    priority: Priority = 'unspecified'
    status: Status = 'todo'
    reviewed: bool = False
    quote: str | None = Field(default=None, min_length=1, max_length=2000)

    @field_validator('title')
    @classmethod
    def nonblank(cls, value):
        if not value.strip():
            raise ValueError('Title must not be blank')
        return value.strip()


class Card(CardInput):
    id: uuid.UUID
    origin: Literal['ai', 'manual']
    start_char: int | None = None
    end_char: int | None = None


class CardCreate(CardInput):
    version: int = Field(ge=0)


class CardUpdate(CardInput):
    version: int = Field(ge=0)


class SummarySentence(BaseModel):
    model_config = ConfigDict(extra='forbid')
    text: str = Field(min_length=1, max_length=1500)
    quote: str = Field(min_length=1, max_length=2000)


class GeneratedCard(BaseModel):
    model_config = ConfigDict(extra='forbid')
    kind: Kind
    title: str = Field(min_length=1, max_length=500)
    description: str = Field(max_length=4000)
    assignee: str | None = Field(max_length=200)
    due_text: str | None = Field(max_length=200)
    priority: Priority
    priority_evidence: str | None = Field(max_length=200)
    quote: str = Field(min_length=1, max_length=2000)


class GeneratedProtocol(BaseModel):
    model_config = ConfigDict(extra='forbid')
    summary: list[SummarySentence] = Field(max_length=5)
    cards: list[GeneratedCard] = Field(max_length=80)


class BoardOutput(BaseModel):
    version: int
    status: Literal['idle', 'queued', 'running', 'ready', 'failed']
    error_code: str | None
    summary: list[SummarySentence]
    cards: list[Card]
    progress: int
