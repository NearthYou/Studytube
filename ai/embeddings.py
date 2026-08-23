from __future__ import annotations

import copy
import hashlib
import math
import os
import time
from typing import Any

try:
    from openai import OpenAI
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    OpenAI = None


EMBEDDING_DIMENSIONS = 1536
RETRIEVAL_EMBEDDING_MODEL = "text-embedding-3-small"
EMBEDDING_RESPONSE_CACHE_TTL_SECONDS = 60 * 60
EMBEDDING_RESPONSE_CACHE_MAX_SIZE = 256
EMBEDDING_RESPONSE_CACHE: dict[str, tuple[float, dict[str, Any]]] = {}
EMBEDDING_INPUT_USD_PER_MILLION_TOKENS = 0.02


class EmbeddingProviderUnavailable(RuntimeError):
    pass


def create_embedding_response(payload: dict[str, Any]) -> dict[str, Any]:
    text = str(payload.get("input") or "").strip()
    if not text or len(text) > 12000:
        raise ValueError("Embedding input must contain between 1 and 12000 characters")
    if not os.getenv("OPENAI_API_KEY") or OpenAI is None:
        raise EmbeddingProviderUnavailable("Embedding provider is unavailable")
    model = os.getenv("EMBEDDING_MODEL", RETRIEVAL_EMBEDDING_MODEL)
    if model != RETRIEVAL_EMBEDDING_MODEL:
        raise EmbeddingProviderUnavailable(
            "Embedding provider must use text-embedding-3-small"
        )
    cache_key = hashlib.sha256(f"{model}\0{text}".encode("utf-8")).hexdigest()
    cached = read_embedding_response_cache(cache_key)
    if cached is not None:
        return cached

    try:
        client = OpenAI(timeout=15.0, max_retries=2)
        response = client.embeddings.create(
            model=model,
            input=text,
            dimensions=EMBEDDING_DIMENSIONS,
            encoding_format="float",
        )
        embedding = [float(value) for value in response.data[0].embedding]
        usage = getattr(response, "usage", None)
        input_tokens = max(0, int(getattr(usage, "prompt_tokens", 0) or 0))
    except Exception as exc:
        raise EmbeddingProviderUnavailable(
            "Embedding provider is unavailable"
        ) from exc

    if len(embedding) != EMBEDDING_DIMENSIONS or any(
        not math.isfinite(value) for value in embedding
    ):
        raise EmbeddingProviderUnavailable("Embedding response is invalid")
    result = {
        "model": model,
        "dimensions": EMBEDDING_DIMENSIONS,
        "embedding": embedding,
        "cacheHit": False,
        "inputTokens": input_tokens,
        "estimatedCostUsd": round(
            input_tokens * EMBEDDING_INPUT_USD_PER_MILLION_TOKENS / 1_000_000,
            12,
        ),
    }
    write_embedding_response_cache(cache_key, result)
    return result


def read_embedding_response_cache(cache_key: str) -> dict[str, Any] | None:
    cached = EMBEDDING_RESPONSE_CACHE.get(cache_key)
    if cached is None:
        return None
    created_at, response = cached
    if time.time() - created_at > EMBEDDING_RESPONSE_CACHE_TTL_SECONDS:
        EMBEDDING_RESPONSE_CACHE.pop(cache_key, None)
        return None
    result = copy.deepcopy(response)
    result["cacheHit"] = True
    result["estimatedCostUsd"] = 0
    return result


def write_embedding_response_cache(
    cache_key: str,
    response: dict[str, Any],
) -> None:
    while len(EMBEDDING_RESPONSE_CACHE) >= EMBEDDING_RESPONSE_CACHE_MAX_SIZE:
        oldest_key = min(
            EMBEDDING_RESPONSE_CACHE,
            key=lambda key: EMBEDDING_RESPONSE_CACHE[key][0],
        )
        EMBEDDING_RESPONSE_CACHE.pop(oldest_key, None)
    EMBEDDING_RESPONSE_CACHE[cache_key] = (time.time(), copy.deepcopy(response))
