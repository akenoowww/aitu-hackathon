import uuid
from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class Question(BaseModel):
    model_config = ConfigDict(extra="forbid")
    question: str = Field(min_length=1, max_length=2000)

    @field_validator("question")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("Question must not be blank")
        return value.strip()


class IndexStatus(BaseModel):
    index_id: uuid.UUID | None
    status: Literal["not_indexed", "queued", "running", "ready", "failed"]
    node_count: int = 0
    error_code: str | None = None


class Evidence(BaseModel):
    model_config = ConfigDict(extra="forbid")
    source_id: str
    quote: str = Field(min_length=1, max_length=2000)


class Claim(BaseModel):
    model_config = ConfigDict(extra="forbid")
    text: str = Field(min_length=1, max_length=3000)
    evidence: list[Evidence] = Field(min_length=1, max_length=5)


class GeneratedAnswer(BaseModel):
    model_config = ConfigDict(extra="forbid")
    status: Literal["answered", "insufficient_evidence"]
    claims: list[Claim] = Field(max_length=12)


class Source(BaseModel):
    source_id: str
    node_id: uuid.UUID
    parent_id: uuid.UUID | None
    start_char: int
    end_char: int
    text: str
    reason: Literal["hit", "parent", "neighbor"]


class Citation(BaseModel):
    source_id: str
    node_id: uuid.UUID
    start_char: int
    end_char: int
    quote: str


class AnswerClaim(BaseModel):
    text: str
    citations: list[Citation]


class Answer(BaseModel):
    status: Literal["answered", "insufficient_evidence"]
    answer: str
    claims: list[AnswerClaim]
    sources: list[Source]
    index_id: uuid.UUID
    model: str
    provider: str
    prompt_version: str


class SearchResult(BaseModel):
    index_id: uuid.UUID
    sources: list[Source]


class RagConfiguration(BaseModel):
    offline: bool
    llm_provider: str
    llm_model: str
    reasoning_effort: str
    embedding_provider: str
    embedding_model: str
    embedding_dimensions: int
    cloud_configured: bool


class GraphNode(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    id: uuid.UUID
    kind: str
    ordinal: int
    parent_id: uuid.UUID | None
    start_char: int
    end_char: int


class GraphEdge(BaseModel):
    model_config = ConfigDict(from_attributes=True)
    source_id: uuid.UUID
    target_id: uuid.UUID
    relation: str


class Graph(BaseModel):
    index_id: uuid.UUID
    nodes: list[GraphNode]
    edges: list[GraphEdge]
