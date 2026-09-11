import hashlib
import uuid

from sqlalchemy import update
from sqlalchemy.exc import IntegrityError

from aimeet_api.modules.intelligence.models import MeetingBoard
from aimeet_api.modules.intelligence.schemas import BoardOutput, Card
from aimeet_api.modules.rag.providers import RagError


def digest(text):
    return hashlib.sha256(text.encode()).hexdigest()


def get_board(db, meeting_id):
    board = db.get(MeetingBoard, meeting_id)
    if board is None:
        board = MeetingBoard(meeting_id=meeting_id)
        db.add(board)
        try:
            db.commit()
        except IntegrityError:
            db.rollback()
            board = db.get(MeetingBoard, meeting_id)
            if board is None:
                raise RagError('MEETING_DELETED', 404) from None
    return board


def output(board):
    return BoardOutput(version=board.version, status=board.status, error_code=board.error_code,
                       summary=board.summary, cards=board.cards, progress=board.progress)


def save_cards(db, board, version, cards):
    if len(cards) > 1500:
        raise RagError('BOARD_FULL', 422)
    changed = db.execute(update(MeetingBoard).execution_options(synchronize_session=False).where(
        MeetingBoard.meeting_id == board.meeting_id, MeetingBoard.version == version,
    ).values(cards=cards, version=MeetingBoard.version + 1))
    if changed.rowcount != 1:
        db.rollback()
        raise RagError('BOARD_CONFLICT', 409)
    db.commit()
    db.refresh(board)
    return output(board)


def make_card(payload, transcript, *, previous=None):
    data = payload.model_dump(mode='json', exclude={'version'})
    quote = data.get('quote')
    start = transcript.find(quote) if quote else -1
    if quote and start < 0:
        raise RagError('QUOTE_NOT_FOUND', 422)
    return Card(**data, id=previous['id'] if previous else uuid.uuid4(),
                origin=previous['origin'] if previous else 'manual',
                start_char=start if start >= 0 else None,
                end_char=start + len(quote) if start >= 0 else None).model_dump(mode='json')
