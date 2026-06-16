from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any

from clients.database_client import DatabaseClient
from services.embedding_service import embedding_to_vector_literal, generate_embedding


DOCUMENT_QUERY = """
WITH post_docs AS (
    SELECT
        'post'::text AS source_type,
        p.id AS source_id,
        p.id AS post_id,
        p.title AS title,
        COALESCE(p.content, p.summary, '') AS content,
        r.code AS region_code,
        b.code AS budget_code,
        t.code AS theme_code,
        p.season::text AS season,
        p.companion::text AS companion,
        p.travel_date,
        p.tags,
        jsonb_build_object(
            'summary', COALESCE(p.summary, ''),
            'authorId', p.author_id,
            'views', p.view_count,
            'commentCount', p.comment_count
        ) AS metadata
    FROM posts p
    JOIN regions r ON r.id = p.region_id
    JOIN budget_ranges b ON b.id = p.budget_range_id
    JOIN themes t ON t.id = p.theme_id
    WHERE (%s IS NULL OR p.id = %s)
),
comment_docs AS (
    SELECT
        'comment'::text AS source_type,
        c.id AS source_id,
        c.post_id AS post_id,
        p.title AS title,
        c.content AS content,
        r.code AS region_code,
        b.code AS budget_code,
        t.code AS theme_code,
        p.season::text AS season,
        p.companion::text AS companion,
        p.travel_date,
        p.tags,
        jsonb_build_object(
            'postTitle', p.title,
            'commentId', c.id,
            'authorId', c.author_id
        ) AS metadata
    FROM comments c
    JOIN posts p ON p.id = c.post_id
    JOIN regions r ON r.id = p.region_id
    JOIN budget_ranges b ON b.id = p.budget_range_id
    JOIN themes t ON t.id = p.theme_id
    WHERE c.is_deleted = FALSE
      AND (%s IS NULL OR p.id = %s)
),
reply_docs AS (
    SELECT
        'reply'::text AS source_type,
        rpl.id AS source_id,
        c.post_id AS post_id,
        p.title AS title,
        rpl.content AS content,
        r.code AS region_code,
        b.code AS budget_code,
        t.code AS theme_code,
        p.season::text AS season,
        p.companion::text AS companion,
        p.travel_date,
        p.tags,
        jsonb_build_object(
            'postTitle', p.title,
            'commentId', c.id,
            'replyId', rpl.id,
            'authorId', rpl.author_id
        ) AS metadata
    FROM comment_replies rpl
    JOIN comments c ON c.id = rpl.comment_id
    JOIN posts p ON p.id = c.post_id
    JOIN regions r ON r.id = p.region_id
    JOIN budget_ranges b ON b.id = p.budget_range_id
    JOIN themes t ON t.id = p.theme_id
    WHERE rpl.is_deleted = FALSE
      AND (%s IS NULL OR p.id = %s)
)
SELECT * FROM post_docs
UNION ALL
SELECT * FROM comment_docs
UNION ALL
SELECT * FROM reply_docs
ORDER BY source_type, source_id
"""


@dataclass
class RagDocument:
    source_type: str
    source_id: int
    post_id: int
    title: str | None
    content: str
    region_code: str | None
    budget_code: str | None
    theme_code: str | None
    season: str | None
    companion: str | None
    travel_date: Any
    tags: list[str]
    metadata: dict[str, Any]


def chunk_text(text: str, chunk_size: int = 700, overlap: int = 120) -> list[str]:
    cleaned = " ".join(text.split())
    if not cleaned:
        return []

    chunks: list[str] = []
    start = 0
    while start < len(cleaned):
        end = min(len(cleaned), start + chunk_size)
        chunks.append(cleaned[start:end])
        if end == len(cleaned):
            break
        start = max(end - overlap, start + 1)
    return chunks


def build_document_text(document: RagDocument) -> str:
    tags = " ".join(document.tags)
    return "\n".join(
        [
            f"Title: {document.title or ''}",
            f"Region: {document.region_code or ''}",
            f"Budget: {document.budget_code or ''}",
            f"Theme: {document.theme_code or ''}",
            f"Season: {document.season or ''}",
            f"Companion: {document.companion or ''}",
            f"Tags: {tags}",
            f"Content: {document.content}",
        ]
    )


def _rows_to_documents(rows: list[dict[str, Any]]) -> list[RagDocument]:
    documents: list[RagDocument] = []
    for row in rows:
        documents.append(
            RagDocument(
                source_type=row["source_type"],
                source_id=int(row["source_id"]),
                post_id=int(row["post_id"]),
                title=row.get("title"),
                content=row["content"],
                region_code=row.get("region_code"),
                budget_code=row.get("budget_code"),
                theme_code=row.get("theme_code"),
                season=row.get("season"),
                companion=row.get("companion"),
                travel_date=row.get("travel_date"),
                tags=row.get("tags") or [],
                metadata=row.get("metadata") or {},
            )
        )
    return documents


def fetch_documents(client: DatabaseClient, post_id: int | None = None) -> list[RagDocument]:
    rows = client.fetch_all(
        DOCUMENT_QUERY,
        (post_id, post_id, post_id, post_id, post_id, post_id),
    )
    return _rows_to_documents(rows)


def clear_scope(client: DatabaseClient, post_id: int | None = None) -> None:
    if post_id is None:
        client.execute("DELETE FROM rag_documents")
        return

    client.execute("DELETE FROM rag_documents WHERE post_id = %s", (post_id,))


async def insert_document(client: DatabaseClient, document: RagDocument) -> int:
    row = client.fetch_one(
        """
        INSERT INTO rag_documents (
            source_type,
            source_id,
            post_id,
            title,
            content,
            region_code,
            budget_code,
            theme_code,
            season,
            companion,
            travel_date,
            tags,
            metadata
        )
        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb)
        RETURNING id
        """,
        (
            document.source_type,
            document.source_id,
            document.post_id,
            document.title,
            document.content,
            document.region_code,
            document.budget_code,
            document.theme_code,
            document.season,
            document.companion,
            document.travel_date,
            document.tags,
            json.dumps(document.metadata),
        ),
    )
    if row is None:
        raise RuntimeError("Failed to insert rag document.")
    return int(row["id"])


async def insert_chunks(client: DatabaseClient, document_id: int, document: RagDocument) -> int:
    chunk_count = 0
    for index, chunk in enumerate(chunk_text(build_document_text(document))):
        embedding = await generate_embedding(chunk)
        vector_literal = embedding_to_vector_literal(embedding)
        client.execute(
            """
            INSERT INTO rag_chunks (
                document_id,
                chunk_index,
                chunk_text,
                embedding,
                post_id,
                region_code,
                budget_code,
                theme_code,
                season,
                companion,
                metadata
            )
            VALUES (%s, %s, %s, %s::vector, %s, %s, %s, %s, %s, %s, %s::jsonb)
            """,
            (
                document_id,
                index,
                chunk,
                vector_literal,
                document.post_id,
                document.region_code,
                document.budget_code,
                document.theme_code,
                document.season,
                document.companion,
                json.dumps(document.metadata),
            ),
        )
        chunk_count += 1
    return chunk_count


def record_sync_job(
    client: DatabaseClient,
    *,
    source_type: str,
    source_id: int,
    job_type: str,
    status: str,
    message: str,
) -> None:
    client.execute(
        """
        INSERT INTO rag_sync_jobs (
            source_type,
            source_id,
            job_type,
            status,
            message
        )
        VALUES (%s, %s, %s, %s, %s)
        """,
        (source_type, source_id, job_type, status, message),
    )


async def sync_documents(post_id: int | None = None) -> dict[str, int]:
    client = DatabaseClient()
    documents = fetch_documents(client, post_id=post_id)
    clear_scope(client, post_id=post_id)

    inserted_documents = 0
    inserted_chunks = 0

    for document in documents:
        document_id = await insert_document(client, document)
        inserted_documents += 1
        inserted_chunks += await insert_chunks(client, document_id, document)

    record_sync_job(
        client,
        source_type="post" if post_id is not None else "all",
        source_id=post_id or 0,
        job_type="sync",
        status="success",
        message=f"documents={inserted_documents}, chunks={inserted_chunks}",
    )

    return {
        "documents": inserted_documents,
        "chunks": inserted_chunks,
    }


async def sync_post_documents(post_id: int) -> dict[str, int]:
    return await sync_documents(post_id=post_id)


async def sync_all_documents() -> dict[str, int]:
    return await sync_documents(post_id=None)
