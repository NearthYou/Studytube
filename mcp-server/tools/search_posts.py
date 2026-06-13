from __future__ import annotations

from collections import defaultdict
from typing import Any

from clients.database_client import DatabaseClient
from services.embedding_service import embedding_to_vector_literal, generate_embedding


VECTOR_SEARCH_QUERY = """
WITH ranked AS (
    SELECT
        rc.id AS chunk_id,
        rc.post_id,
        rc.chunk_text,
        rc.region_code,
        rc.budget_code,
        rc.theme_code,
        rc.season,
        rc.companion,
        1 - (rc.embedding <=> %s::vector) AS similarity
    FROM rag_chunks rc
    WHERE rc.embedding IS NOT NULL
      AND (%s = '' OR rc.region_code = %s)
      AND (%s = '' OR rc.budget_code = %s)
      AND (%s = '' OR rc.theme_code = %s)
      AND (%s = '' OR LOWER(rc.season) = LOWER(%s))
      AND (%s = '' OR LOWER(rc.companion) = LOWER(%s))
    ORDER BY rc.embedding <=> %s::vector
    LIMIT %s
)
SELECT *
FROM ranked
ORDER BY similarity DESC, chunk_id ASC
"""

POST_DETAIL_QUERY = """
SELECT
    p.id,
    p.title,
    COALESCE(p.summary, '') AS summary,
    COALESCE(p.content, '') AS content,
    r.name AS region,
    b.label AS budget,
    t.name AS theme,
    p.companion::text AS companion,
    p.travel_date::text AS "travelDate"
FROM posts p
JOIN regions r ON r.id = p.region_id
JOIN budget_ranges b ON b.id = p.budget_range_id
JOIN themes t ON t.id = p.theme_id
WHERE p.id = ANY(%s::bigint[])
"""

SEASON_MAP = {
    "spring": "봄",
    "summer": "여름",
    "fall": "가을",
    "autumn": "가을",
    "winter": "겨울",
    "봄": "봄",
    "여름": "여름",
    "가을": "가을",
    "겨울": "겨울",
}

COMPANION_MAP = {
    "solo": "혼자",
    "alone": "혼자",
    "friend": "친구",
    "friends": "친구",
    "couple": "연인",
    "lover": "연인",
    "family": "가족",
    "혼자": "혼자",
    "친구": "친구",
    "연인": "연인",
    "가족": "가족",
}

REGION_MAP = {
    "busan": "busan",
    "부산": "busan",
    "jeju": "jeju",
    "제주": "jeju",
    "gangneung": "gangneung",
    "강릉": "gangneung",
    "jeonju": "jeonju",
    "전주": "jeonju",
    "yeosu": "yeosu",
    "여수": "yeosu",
    "sokcho": "sokcho",
    "속초": "sokcho",
    "namhae": "namhae",
    "남해": "namhae",
    "chuncheon": "chuncheon",
    "춘천": "chuncheon",
    "pohang": "pohang",
    "포항": "pohang",
    "gyeongju": "gyeongju",
    "경주": "gyeongju",
    "tongyeong": "tongyeong",
    "통영": "tongyeong",
    "gapyeong": "gapyeong",
    "가평": "gapyeong",
}

THEME_MAP = {
    "healing": "healing",
    "힐링": "healing",
    "family": "family",
    "가족": "family",
    "couple": "couple",
    "연인": "couple",
    "solo": "solo_trip",
    "혼행": "solo_trip",
    "gourmet": "gourmet",
    "미식": "gourmet",
    "drive": "drive",
    "드라이브": "drive",
    "date": "date",
    "데이트": "date",
}

BUDGET_MAP = {
    "under_100k": "under_100k",
    "100k": "under_100k",
    "10만원 이하": "under_100k",
    "from_100k_to_200k": "from_100k_to_200k",
    "100k to 200k": "from_100k_to_200k",
    "10~20만원": "from_100k_to_200k",
    "from_200k_to_300k": "from_200k_to_300k",
    "200k to 300k": "from_200k_to_300k",
    "20~30만원": "from_200k_to_300k",
    "over_300k": "over_300k",
    "300k+": "over_300k",
    "30만원 이상": "over_300k",
}


def _normalize_query_parts(
    query: str,
    region: str,
    budget: str,
    theme: str,
    season: str,
    companion: str,
) -> str:
    parts = [query.strip(), region.strip(), budget.strip(), theme.strip(), season.strip(), companion.strip()]
    return " ".join(part for part in parts if part)


def _normalize_filter(value: str, mapping: dict[str, str]) -> str:
    normalized = value.strip().lower()
    if not normalized:
        return ""
    return mapping.get(normalized, "")


async def _search_with_vectors(
    query: str,
    region: str,
    budget: str,
    theme: str,
    season: str,
    companion: str,
    limit: int,
) -> list[dict[str, Any]]:
    if not query.strip():
        return []

    embedding = await generate_embedding(query)
    vector_literal = embedding_to_vector_literal(embedding)
    db = DatabaseClient()
    normalized_region = _normalize_filter(region, REGION_MAP)
    normalized_budget = _normalize_filter(budget, BUDGET_MAP)
    normalized_theme = _normalize_filter(theme, THEME_MAP)
    normalized_season = _normalize_filter(season, SEASON_MAP)
    normalized_companion = _normalize_filter(companion, COMPANION_MAP)
    rows = db.fetch_all(
        VECTOR_SEARCH_QUERY,
        (
            vector_literal,
            normalized_region,
            normalized_region,
            normalized_budget,
            normalized_budget,
            normalized_theme,
            normalized_theme,
            normalized_season,
            normalized_season,
            normalized_companion,
            normalized_companion,
            vector_literal,
            max(limit * 4, 8),
        ),
    )

    if not rows:
        return []

    post_ids = sorted({row["post_id"] for row in rows if row.get("post_id") is not None})
    post_rows = db.fetch_all(POST_DETAIL_QUERY, (post_ids,))
    post_lookup = {int(row["id"]): row for row in post_rows}

    scores: dict[int, float] = defaultdict(float)
    excerpts: dict[int, str] = {}
    for row in rows:
        post_id = row["post_id"]
        scores[post_id] += float(row["similarity"])
        excerpts.setdefault(post_id, row["chunk_text"][:220])

    ranked_post_ids = sorted(scores, key=lambda post_id: scores[post_id], reverse=True)[:limit]
    normalized_items: list[dict[str, Any]] = []
    for post_id in ranked_post_ids:
        post = post_lookup.get(post_id)
        if not post:
            continue

        normalized_items.append(
            {
                "postId": post.get("id"),
                "title": post.get("title", ""),
                "summary": post.get("summary", ""),
                "region": post.get("region", ""),
                "budget": post.get("budget", ""),
                "theme": post.get("theme", ""),
                "companion": post.get("companion", ""),
                "travelDate": post.get("travelDate", ""),
                "score": round(scores[post_id], 4),
                "matchedExcerpt": excerpts.get(post_id, post.get("summary", "")),
            }
        )

    return normalized_items


async def _search_with_api(
    full_query: str,
    region: str,
    budget: str,
    theme: str,
    season: str,
    companion: str,
    limit: int,
) -> list[dict[str, Any]]:
    from clients.back_api_client import BackApiClient

    client = BackApiClient()
    response = await client.get_json(
        "/posts",
        params={
            "q": full_query,
            "regionCode": _normalize_filter(region, REGION_MAP) or None,
            "budgetCode": _normalize_filter(budget, BUDGET_MAP) or None,
            "themeCode": _normalize_filter(theme, THEME_MAP) or None,
            "season": _normalize_filter(season, SEASON_MAP) or None,
            "companion": _normalize_filter(companion, COMPANION_MAP) or None,
            "limit": max(1, min(limit, 10)),
            "page": 1,
            "sort": "latest",
        },
    )

    items = response.get("items", [])
    normalized_items = []
    for index, item in enumerate(items):
        normalized_items.append(
            {
                "postId": item.get("id"),
                "title": item.get("title", ""),
                "summary": item.get("summary", ""),
                "region": item.get("region", ""),
                "budget": item.get("budget", ""),
                "theme": item.get("theme", ""),
                "companion": item.get("companion", ""),
                "travelDate": item.get("travelDate", ""),
                "score": round(max(0.1, 1 - index * 0.1), 3),
                "matchedExcerpt": item.get("summary") or item.get("content", "")[:220],
            }
        )
    return normalized_items


async def search_posts(
    query: str,
    region: str = "",
    budget: str = "",
    theme: str = "",
    season: str = "",
    companion: str = "",
    limit: int = 5,
) -> dict[str, Any]:
    full_query = _normalize_query_parts(query, region, budget, theme, season, companion)

    try:
        normalized_items = await _search_with_vectors(
            query=full_query,
            region=region,
            budget=budget,
            theme=theme,
            season=season,
            companion=companion,
            limit=max(1, min(limit, 10)),
        )
    except Exception:
        normalized_items = []

    if not normalized_items:
        normalized_items = await _search_with_api(
            full_query=full_query,
            region=region,
            budget=budget,
            theme=theme,
            season=season,
            companion=companion,
            limit=max(1, min(limit, 10)),
        )

    return {
        "query": full_query,
        "total": len(normalized_items),
        "items": normalized_items,
    }
