import uuid
from typing import Annotated

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select

from aimeet_api.core.dependencies import CurrentUser, DatabaseDep, SettingsDep, require_csrf
from aimeet_api.modules.meetings.repository import MeetingRepository
from aimeet_api.modules.rag.chunking import embedding_profile, source_hash
from aimeet_api.modules.rag.indexing import enqueue
from aimeet_api.modules.rag.models import RagEdge, RagIndex, RagNode
from aimeet_api.modules.rag.providers import Providers, RagError
from aimeet_api.modules.rag.retrieval import retrieve
from aimeet_api.modules.rag.schemas import (
    Answer,
    Graph,
    GraphEdge,
    GraphNode,
    IndexStatus,
    Question,
    RagConfiguration,
    SearchResult,
)
from aimeet_api.modules.rag.service import answer_question

router = APIRouter(tags=["RAG"])


def get_providers(settings: SettingsDep):
    return Providers(settings)


ProviderDep = Annotated[Providers, Depends(get_providers)]


def get_meeting(db, user, meeting_id):
    meeting = MeetingRepository(db, user.workspace_id).get(meeting_id)
    if meeting is None:
        raise HTTPException(404, "Meeting not found")
    if not meeting.transcript.strip():
        raise RagError("TRANSCRIPT_NOT_READY", 409)
    if len(meeting.transcript) > 200_000:
        raise RagError("TRANSCRIPT_TOO_LARGE", 413)
    return meeting


def get_index(db, meeting, settings, *, ready=False):
    index = db.scalar(
        select(RagIndex).where(
            RagIndex.meeting_id == meeting.id,
            RagIndex.profile == embedding_profile(settings),
            RagIndex.source_hash == source_hash(meeting.transcript),
        )
    )
    if ready and (index is None or index.status != "ready"):
        raise RagError("INDEX_NOT_READY", 409)
    if index and index.source_hash != source_hash(meeting.transcript):
        raise RagError("SOURCE_CHANGED", 409)
    return index


def status_of(index):
    return IndexStatus(
        index_id=index.id if index else None,
        status=index.status if index else "not_indexed",
        node_count=index.node_count if index else 0,
        error_code=index.error_code if index else None,
    )


@router.get("/rag/config", response_model=RagConfiguration, operation_id="getRagConfig")
def configuration(user: CurrentUser, settings: SettingsDep):
    return RagConfiguration(
        offline=settings.rag_offline,
        llm_provider=settings.rag_llm_provider,
        llm_model=settings.rag_llm_model,
        reasoning_effort=settings.rag_reasoning_effort,
        embedding_provider=settings.rag_embedding_provider,
        embedding_model=settings.rag_embedding_model,
        embedding_dimensions=settings.rag_embedding_dimensions,
        cloud_configured=bool(settings.openai_api_key.get_secret_value()),
    )


@router.get(
    "/meetings/{meeting_id}/rag/index", response_model=IndexStatus, operation_id="getRagIndex"
)
def index_status(meeting_id: uuid.UUID, user: CurrentUser, db: DatabaseDep, settings: SettingsDep):
    meeting = get_meeting(db, user, meeting_id)
    return status_of(get_index(db, meeting, settings))


@router.post(
    "/meetings/{meeting_id}/rag/index",
    response_model=IndexStatus,
    status_code=202,
    dependencies=[Depends(require_csrf)],
    operation_id="indexMeeting",
)
def index_meeting(
    meeting_id: uuid.UUID,
    user: CurrentUser,
    db: DatabaseDep,
    settings: SettingsDep,
    providers: ProviderDep,
):
    meeting = get_meeting(db, user, meeting_id)
    providers.ensure_configured()
    return status_of(enqueue(db, meeting, settings))


@router.get("/meetings/{meeting_id}/rag/graph", response_model=Graph, operation_id="getRagGraph")
def graph(meeting_id: uuid.UUID, user: CurrentUser, db: DatabaseDep, settings: SettingsDep):
    index = get_index(db, get_meeting(db, user, meeting_id), settings, ready=True)
    return Graph(
        index_id=index.id,
        nodes=[
            GraphNode.model_validate(node)
            for node in db.scalars(
                select(RagNode).where(RagNode.index_id == index.id).order_by(RagNode.start_char)
            )
        ],
        edges=[
            GraphEdge.model_validate(edge)
            for edge in db.scalars(select(RagEdge).where(RagEdge.index_id == index.id))
        ],
    )


def search_sources(db, user, meeting_id, settings, providers, payload):
    index = get_index(db, get_meeting(db, user, meeting_id), settings, ready=True)
    index_id = index.id
    db.rollback()  # Release auth/read transaction while waiting for an embedding provider.
    vector = providers.embed([payload.question])[0]
    # Recheck access/existence after provider IO, before loading any source content.
    index = get_index(db, get_meeting(db, user, meeting_id), settings, ready=True)
    if index.id != index_id:
        raise RagError("SOURCE_CHANGED", 409)
    sources = retrieve(db, index_id, payload.question, vector, settings)
    db.rollback()
    return index_id, sources


@router.post(
    "/meetings/{meeting_id}/rag/search",
    response_model=SearchResult,
    dependencies=[Depends(require_csrf)],
    operation_id="searchMeeting",
)
def search(
    meeting_id: uuid.UUID,
    payload: Question,
    user: CurrentUser,
    db: DatabaseDep,
    settings: SettingsDep,
    providers: ProviderDep,
):
    index_id, sources = search_sources(db, user, meeting_id, settings, providers, payload)
    return SearchResult(index_id=index_id, sources=sources)


@router.post(
    "/meetings/{meeting_id}/rag/chat",
    response_model=Answer,
    dependencies=[Depends(require_csrf)],
    operation_id="askMeeting",
)
def chat(
    meeting_id: uuid.UUID,
    payload: Question,
    user: CurrentUser,
    db: DatabaseDep,
    settings: SettingsDep,
    providers: ProviderDep,
):
    # Authorization always precedes configuration errors and provider work.
    get_meeting(db, user, meeting_id)
    providers.ensure_configured(generation=True)
    index_id, sources = search_sources(db, user, meeting_id, settings, providers, payload)
    result = answer_question(index_id, payload.question, sources, settings, providers)
    current = get_index(db, get_meeting(db, user, meeting_id), settings, ready=True)
    if current.id != index_id:
        raise RagError("SOURCE_CHANGED", 409)
    return result
