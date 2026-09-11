import uuid

from aimeet_api.db.models import User


def create(client):
    response = client.post("/api/v1/assistant/conversations", json={"id": str(uuid.uuid4())})
    assert response.status_code == 200, response.text
    return response.json()["id"]


def turn(question, answer):
    return {
        "id": str(uuid.uuid4()),
        "question": question,
        "result": {"mode": "assistant", "answer": answer},
    }


def test_separate_conversations_persist_and_title_from_first_message(authenticated_client):
    client = authenticated_client
    first, second = create(client), create(client)
    a, b = turn("Первый разговор", "Первый ответ"), turn("Второй разговор", "Второй ответ")
    for cid, payload in [(first, a), (second, b)]:
        response = client.post(f"/api/v1/assistant/conversations/{cid}/turns", json=payload)
        assert response.status_code == 200, response.text
    assert (
        client.get(f"/api/v1/assistant/conversations/{first}").json()["turns"][0]["result"][
            "answer"
        ]
        == "Первый ответ"
    )
    assert (
        client.get(f"/api/v1/assistant/conversations/{second}").json()["turns"][0]["result"][
            "answer"
        ]
        == "Второй ответ"
    )
    rows = client.get("/api/v1/assistant/conversations").json()
    assert {r["title"] for r in rows} == {"Первый разговор", "Второй разговор"}
    replay = client.post(f"/api/v1/assistant/conversations/{first}/turns", json=a)
    assert replay.status_code == 200
    assert len(client.get(f"/api/v1/assistant/conversations/{first}").json()["turns"]) == 1
    assert client.post(f"/api/v1/assistant/conversations/{second}/turns", json=a).status_code == 409


def test_private_chats_hidden_even_from_same_workspace(app, authenticated_client, alice, bob):
    client = authenticated_client
    cid = create(client)
    assert (
        client.post(
            f"/api/v1/assistant/conversations/{cid}/turns", json=turn("Личное", "Ответ")
        ).status_code
        == 200
    )
    with app.state.session_factory() as db:
        db.get(User, uuid.UUID(bob.id)).workspace_id = db.get(
            User, uuid.UUID(alice.id)
        ).workspace_id
        db.commit()
    client.post("/api/v1/auth/logout")
    client.post("/api/v1/auth/login", json=bob.credentials)
    assert client.get("/api/v1/assistant/conversations").json() == []
    assert client.get(f"/api/v1/assistant/conversations/{cid}").status_code == 404
    assert client.post("/api/v1/assistant/conversations", json={"id": cid}).status_code == 404
    assert (
        client.post(
            f"/api/v1/assistant/conversations/{cid}/turns", json=turn("Чужое", "Ответ")
        ).status_code
        == 404
    )


def test_conversation_auth_validation_and_create_idempotency(client, authenticated_client):
    client = authenticated_client
    cid = create(client)
    assert client.post("/api/v1/assistant/conversations", json={"id": cid}).status_code == 200
    assert len(client.get("/api/v1/assistant/conversations").json()) == 1
    invalid = turn("Вопрос", "Ответ")
    invalid["result"]["mode"] = "system"
    assert (
        client.post(f"/api/v1/assistant/conversations/{cid}/turns", json=invalid).status_code == 422
    )
    client.headers.pop("X-Requested-With")
    assert (
        client.post("/api/v1/assistant/conversations", json={"id": str(uuid.uuid4())}).status_code
        == 403
    )
    client.headers["X-Requested-With"] = "aimeet"
    client.post("/api/v1/auth/logout")
    assert client.get("/api/v1/assistant/conversations").status_code == 401
