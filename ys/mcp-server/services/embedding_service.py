from __future__ import annotations

from typing import Any

import httpx

from config import EMBEDDING_DIMENSIONS, EMBEDDING_MODEL, OPENAI_API_KEY


EMBEDDINGS_URL = "https://api.openai.com/v1/embeddings"


def normalize_text_for_embedding(text: str) -> str:
    cleaned = " ".join(text.split())
    return cleaned[:6000]


async def generate_embedding(text: str) -> list[float]:
    if not OPENAI_API_KEY:
        raise RuntimeError("OPENAI_API_KEY or GPT_API_KEY is required for embeddings.")

    payload: dict[str, Any] = {
        "input": normalize_text_for_embedding(text),
        "model": EMBEDDING_MODEL,
    }

    if EMBEDDING_MODEL == "text-embedding-3-small":
        payload["dimensions"] = EMBEDDING_DIMENSIONS

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            EMBEDDINGS_URL,
            headers={
                "Authorization": f"Bearer {OPENAI_API_KEY}",
                "Content-Type": "application/json",
            },
            json=payload,
        )
        response.raise_for_status()
        data = response.json()

    embedding = data["data"][0]["embedding"]
    return [float(value) for value in embedding]


def embedding_to_vector_literal(embedding: list[float]) -> str:
    return "[" + ",".join(f"{value:.8f}" for value in embedding) + "]"
