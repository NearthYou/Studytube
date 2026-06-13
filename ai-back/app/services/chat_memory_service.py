from __future__ import annotations

from typing import Any
from uuid import uuid4

from app.database import DatabaseClient


MESSAGE_LIMIT = 12


def create_session_id() -> str:
    return str(uuid4())


def load_recent_history(session_id: str, limit: int = MESSAGE_LIMIT) -> list[dict[str, str]]:
    if not session_id.strip():
        return []

    try:
        client = DatabaseClient()
        rows = client.fetch_all(
            """
            SELECT role, content
            FROM ai_chat_messages
            WHERE session_id = %s::uuid
            ORDER BY id DESC
            LIMIT %s
            """,
            (session_id, limit),
        )
    except Exception:
        return []

    rows.reverse()
    return [
        {
            "role": str(row.get("role", "")),
            "content": str(row.get("content", "")),
        }
        for row in rows
        if row.get("role") and row.get("content")
    ]


def store_chat_exchange(
    session_id: str,
    language: str,
    user_message: str,
    assistant_message: str,
) -> None:
    try:
        client = DatabaseClient()
        client.execute(
            """
            INSERT INTO ai_chat_sessions (session_id, language)
            VALUES (%s::uuid, %s)
            ON CONFLICT (session_id)
            DO UPDATE SET
                language = EXCLUDED.language,
                updated_at = NOW()
            """,
            (session_id, language),
        )
        client.execute(
            """
            INSERT INTO ai_chat_messages (session_id, role, content)
            VALUES
                (%s::uuid, 'user', %s),
                (%s::uuid, 'assistant', %s)
            """,
            (session_id, user_message, session_id, assistant_message),
        )
    except Exception:
        return


def format_history_block(history: list[dict[str, Any]]) -> str:
    if not history:
        return "Conversation history:\n- none"

    lines = ["Conversation history:"]
    for item in history:
        role = "assistant" if item.get("role") == "assistant" else "user"
        content = str(item.get("content", "")).strip()
        if not content:
            continue
        lines.append(f"- {role}: {content}")
    return "\n".join(lines)
