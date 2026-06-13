from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any

from app.rag.schemas import RagChunk, RetrievedChunk, Species


class LocalKeywordStore:
    def __init__(self, chunks: list[RagChunk]):
        self.chunks = chunks

    def search(
        self,
        query: str,
        species: Species | None = None,
        topic: str | None = None,
        limit: int = 5,
    ) -> list[RetrievedChunk]:
        terms = [term for term in query.lower().split() if len(term) >= 2]
        scored: list[RetrievedChunk] = []

        for chunk in self.chunks:
            species_match = species in {None, "unknown"} or chunk.species in {
                species,
                "both",
                "unknown",
            }
            topic_bonus = 1.0 if topic and chunk.topic == topic else 0.0

            if not species_match:
                continue

            lowered = chunk.chunk_text.lower()
            keyword_hits = sum(1 for term in terms if term in lowered)
            taxonomy_hits = sum(
                1
                for term in chunk.topic.replace(".", " ").replace("_", " ").split()
                if term in query.lower()
            )
            score = keyword_hits + taxonomy_hits + topic_bonus + chunk.source_priority

            if score <= 0:
                continue

            scored.append(
                RetrievedChunk(
                    chunk_id=chunk.chunk_id,
                    chunk_text=chunk.chunk_text,
                    score=score,
                    keyword_score=float(keyword_hits),
                    species=chunk.species,
                    topic=chunk.topic,
                    safety_level=chunk.safety_level,
                    source_title=chunk.source_title,
                    source_year=chunk.source_year,
                    pmid=chunk.pmid,
                    pmcid=chunk.pmcid,
                    url=chunk.url,
                )
            )

        scored.sort(key=lambda item: item.score, reverse=True)
        return scored[:limit]


class PgVectorStore:
    def __init__(self, database_url: str | None = None):
        self.database_url = database_url or os.getenv("DATABASE_URL")

    def is_configured(self) -> bool:
        return bool(self.database_url)

    def upsert_chunks(
        self,
        chunks: list[RagChunk],
        embeddings: list[list[float]],
    ) -> None:
        if not self.database_url:
            raise RuntimeError("DATABASE_URL is required for pgvector ingestion.")

        import psycopg

        with psycopg.connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                for chunk, embedding in zip(chunks, embeddings):
                    cursor.execute(
                        """
                        INSERT INTO rag_documents (
                          source_title, species, year, pmid, pmcid, doi, url,
                          source_type, priority, license_note
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s)
                        ON CONFLICT (source_title, year)
                        DO UPDATE SET
                          species = EXCLUDED.species,
                          pmid = EXCLUDED.pmid,
                          pmcid = EXCLUDED.pmcid,
                          doi = EXCLUDED.doi,
                          url = EXCLUDED.url,
                          source_type = EXCLUDED.source_type,
                          priority = EXCLUDED.priority
                        RETURNING id
                        """,
                        (
                            chunk.source_title,
                            chunk.species,
                            chunk.source_year,
                            chunk.pmid,
                            chunk.pmcid,
                            chunk.doi,
                            chunk.url,
                            chunk.source_type,
                            chunk.source_priority,
                            "Project sourcebook summary; avoid long verbatim source quotes.",
                        ),
                    )
                    document_id = cursor.fetchone()[0]
                    cursor.execute(
                        """
                        INSERT INTO rag_chunks (
                          document_id, chunk_index, chunk_id, species, topic,
                          subtopic, safety_level, chunk_text, embedding, token_count
                        )
                        VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s::vector, %s)
                        ON CONFLICT (document_id, chunk_index)
                        DO UPDATE SET
                          chunk_id = EXCLUDED.chunk_id,
                          species = EXCLUDED.species,
                          topic = EXCLUDED.topic,
                          subtopic = EXCLUDED.subtopic,
                          safety_level = EXCLUDED.safety_level,
                          chunk_text = EXCLUDED.chunk_text,
                          embedding = EXCLUDED.embedding,
                          token_count = EXCLUDED.token_count
                        """,
                        (
                            document_id,
                            chunk.chunk_index,
                            chunk.chunk_id,
                            chunk.species,
                            chunk.topic,
                            chunk.subtopic,
                            chunk.safety_level,
                            chunk.chunk_text,
                            to_vector_literal(embedding),
                            chunk.token_count,
                        ),
                    )

    def search(
        self,
        query_embedding: list[float],
        query: str,
        species: Species | None = None,
        topic: str | None = None,
        limit: int = 5,
    ) -> list[RetrievedChunk]:
        if not self.database_url:
            return []

        import psycopg

        vector = to_vector_literal(query_embedding)
        params: list[Any] = [vector]
        filters = ["c.embedding IS NOT NULL"]

        if species and species != "unknown":
            filters.append("(c.species = %s OR c.species = 'both' OR c.species = 'unknown')")
            params.append(species)

        if topic:
            filters.append("(c.topic = %s OR c.topic LIKE %s OR c.safety_level IN ('emergency', 'vet_consult'))")
            params.extend([topic, f"{topic.split('.')[0]}.%"])

        where_clause = " AND ".join(filters)
        params.extend([vector, limit])

        sql = f"""
            SELECT
              c.chunk_id,
              c.chunk_text,
              c.species,
              c.topic,
              c.safety_level,
              d.source_title,
              d.year,
              d.pmid,
              d.pmcid,
              d.url,
              1 - (c.embedding <=> %s::vector) AS vector_similarity,
              d.priority
            FROM rag_chunks c
            JOIN rag_documents d ON d.id = c.document_id
            WHERE {where_clause}
            ORDER BY c.embedding <=> %s::vector
            LIMIT %s
        """

        with psycopg.connect(self.database_url) as connection:
            with connection.cursor() as cursor:
                cursor.execute(sql, params)
                rows = cursor.fetchall()

        results: list[RetrievedChunk] = []
        query_terms = [term for term in query.lower().split() if len(term) >= 2]

        for row in rows:
            keyword_score = float(
                sum(1 for term in query_terms if term in str(row[1]).lower())
            )
            vector_similarity = float(row[10] or 0)
            source_priority = float(row[11] or 0)
            final_score = (
                0.55 * vector_similarity
                + 0.25 * min(keyword_score, 4) / 4
                + 0.15 * source_priority
                + 0.05 * (1 if source_priority >= 0.85 else 0)
            )
            results.append(
                RetrievedChunk(
                    chunk_id=row[0],
                    chunk_text=row[1],
                    species=row[2],
                    topic=row[3],
                    safety_level=row[4],
                    source_title=row[5],
                    source_year=row[6],
                    pmid=row[7],
                    pmcid=row[8],
                    url=row[9],
                    vector_similarity=vector_similarity,
                    keyword_score=keyword_score,
                    score=final_score,
                )
            )

        results.sort(key=lambda item: item.score, reverse=True)
        return results


def load_chunks_from_json(path: Path) -> list[RagChunk]:
    if not path.exists() or path.stat().st_size == 0:
        return []

    data = json.loads(path.read_text(encoding="utf-8"))
    return [RagChunk(**item) for item in data]


def to_vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in embedding) + "]"
