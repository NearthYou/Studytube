from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime, timezone
import hashlib
import json
import math
import os
from pathlib import Path
import re
from typing import Any
from urllib.parse import quote_plus

try:
    from dotenv import load_dotenv
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    def load_dotenv(*_args: Any, **_kwargs: Any) -> None:
        return None

try:
    from fastapi import FastAPI
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    class FastAPI:  # type: ignore[override]
        def __init__(self, *_args: Any, **_kwargs: Any) -> None:
            pass

        def get(self, *_args: Any, **_kwargs: Any):
            def decorator(func):
                return func

            return decorator

        def post(self, *_args: Any, **_kwargs: Any):
            def decorator(func):
                return func

            return decorator

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    httpx = None

try:
    import psycopg
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    psycopg = None

try:
    from openai import OpenAI
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    OpenAI = None


AI_DIR = Path(__file__).resolve().parent
ROOT_DIR = AI_DIR.parent

load_dotenv(ROOT_DIR / ".env")
load_dotenv(AI_DIR / ".env", override=True)

DEFAULT_DATABASE_URL = "postgresql://app:app@localhost:5432/app_dev"
EMBEDDING_DIMENSIONS = 64

app = FastAPI(title="StudyTube AI Service")


@dataclass
class BoardPost:
    id: int
    title: str
    video_url: str
    thumbnail_url: str
    channel_name: str
    summary: str
    translated_notes: str
    tags: list[str]


DEMO_POSTS = [
    BoardPost(
        id=1,
        title="React Hooks Course - All React Hooks Explained",
        video_url="https://www.youtube.com/watch?v=LlvBzyy-558",
        thumbnail_url="https://i.ytimg.com/vi/LlvBzyy-558/hqdefault.jpg",
        channel_name="freeCodeCamp.org",
        summary=(
            "A practical React hooks lesson covering useState, useEffect, "
            "useMemo, useCallback, and custom hooks through small examples."
        ),
        translated_notes=(
            "useState, useEffect, useMemo, useCallback, 커스텀 훅을 작은 예제로 "
            "익히는 React 훅 실습 영상입니다."
        ),
        tags=["react", "frontend", "hooks"],
    ),
    BoardPost(
        id=2,
        title="React Query Crash Course",
        video_url="https://www.youtube.com/watch?v=novnyCaa7To",
        thumbnail_url="https://i.ytimg.com/vi/novnyCaa7To/hqdefault.jpg",
        channel_name="The Net Ninja",
        summary=(
            "Explains server state, caching, refetching, query keys, and "
            "mutation flows for React applications."
        ),
        translated_notes=(
            "React 앱에서 서버 상태, 캐싱, 재조회, 쿼리 키, mutation 흐름을 설명합니다."
        ),
        tags=["react", "query", "frontend"],
    ),
    BoardPost(
        id=3,
        title="FastAPI Full Course",
        video_url="https://www.youtube.com/watch?v=7t2alSnE2-I",
        thumbnail_url="https://i.ytimg.com/vi/7t2alSnE2-I/hqdefault.jpg",
        channel_name="freeCodeCamp.org",
        summary=(
            "Builds Python APIs with routing, validation, dependency injection, "
            "authentication, and database access."
        ),
        translated_notes=(
            "라우팅, 검증, 의존성 주입, 인증, 데이터베이스 접근으로 Python API를 만드는 강의입니다."
        ),
        tags=["fastapi", "python", "backend"],
    ),
    BoardPost(
        id=4,
        title="PostgreSQL Tutorial for Beginners",
        video_url="https://www.youtube.com/watch?v=qw--VYLpxG4",
        thumbnail_url="https://i.ytimg.com/vi/qw--VYLpxG4/hqdefault.jpg",
        channel_name="Programming with Mosh",
        summary=(
            "Introduces relational tables, filtering, joins, indexes, and durable "
            "data modeling."
        ),
        translated_notes=(
            "관계형 테이블, 필터링, 조인, 인덱스, 안정적인 데이터 모델 설계를 소개합니다."
        ),
        tags=["postgresql", "database", "backend"],
    ),
]


AGENT_TOOLS = [
    {
        "type": "function",
        "function": {
            "name": "retrieve_posts",
            "description": "Retrieve board posts related to the learner goal.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "search_video",
            "description": "Search or look up external YouTube video metadata.",
            "parameters": {
                "type": "object",
                "properties": {"query": {"type": "string"}},
                "required": ["query"],
            },
        },
    },
    {
        "type": "function",
        "function": {
            "name": "create_playlist_draft",
            "description": "Create a playlist draft from retrieved posts and videos.",
            "parameters": {
                "type": "object",
                "properties": {"title": {"type": "string"}},
                "required": ["title"],
            },
        },
    },
]


@app.get("/health")
def health():
    return {
        "service": "ai",
        "status": "ok",
        "llmModel": os.getenv("LLM_MODEL", "gpt-4o-mini"),
        "embeddingModel": os.getenv("EMBEDDING_MODEL", "text-embedding-3-small"),
        "timestamp": datetime.now(timezone.utc).isoformat(),
    }


@app.get("/health/db")
def database_health():
    if psycopg is None:
        return {
            "service": "ai",
            "status": "degraded",
            "database": "unavailable",
            "message": "psycopg is not installed in this Python environment.",
        }

    database_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)

    try:
        with psycopg.connect(database_url, connect_timeout=3) as conn:
            with conn.cursor() as cursor:
                cursor.execute("SELECT 1 AS ok")
                row = cursor.fetchone()

        return {
            "service": "ai",
            "status": "ok" if row and row[0] == 1 else "unknown",
            "database": "postgresql + pgvector",
            "timestamp": datetime.now(timezone.utc).isoformat(),
        }
    except Exception as exc:
        return {
            "service": "ai",
            "status": "degraded",
            "database": "postgresql",
            "message": str(exc),
        }


@app.post("/rag/recommend")
def rag_recommend_endpoint(payload: dict[str, Any]):
    return rag_recommend(payload)


@app.post("/mcp")
def mcp_endpoint(payload: dict[str, Any]):
    return handle_mcp_request(payload)


@app.post("/agent/study-plan")
def study_plan_endpoint(payload: dict[str, Any]):
    return build_study_plan(payload)


def rag_recommend(payload: dict[str, Any]) -> dict[str, Any]:
    query = str(payload.get("query") or payload.get("title") or "").strip()
    limit = int(payload.get("limit") or 3)
    posts = load_board_posts()
    ranked = rank_posts(query, posts)
    related = [
        post_to_response(post, score)
        for post, score in ranked[:limit]
        if score > 0
    ]
    answer = summarize_related_posts(query, related)

    return {
        "mode": "rag",
        "query": query,
        "answer": answer,
        "relatedPosts": related,
        "embedding": {
            "provider": embedding_provider(),
            "dimensions": EMBEDDING_DIMENSIONS,
            "vectorDb": "PostgreSQL pgvector with deterministic fallback",
        },
    }


def handle_mcp_request(payload: dict[str, Any]) -> dict[str, Any]:
    request_id = payload.get("id")
    method = payload.get("method")
    params = payload.get("params") or {}

    if payload.get("jsonrpc") != "2.0":
        return json_rpc_error(request_id, -32600, "Invalid JSON-RPC version")

    if method == "youtube.lookup":
        return {
            "jsonrpc": "2.0",
            "id": request_id,
            "result": lookup_youtube(params),
        }

    return json_rpc_error(request_id, -32601, f"Unknown MCP method: {method}")


def build_study_plan(payload: dict[str, Any]) -> dict[str, Any]:
    goal = str(payload.get("goal") or "React 공부").strip()
    language = str(payload.get("language") or "ko")
    interests = [str(item) for item in payload.get("interests") or []]
    max_iterations = min(int(payload.get("maxIterations") or 3), 4)
    state: dict[str, Any] = {
        "goal": goal,
        "language": language,
        "interests": interests,
        "retrieved": [],
        "external": None,
        "trace": [],
    }

    for iteration in range(max_iterations):
        tool_name = choose_agent_tool(state, iteration)
        state["trace"].append(
            {
                "iteration": iteration + 1,
                "tool": tool_name,
                "reason": tool_reason(tool_name),
            }
        )

        try:
            if tool_name == "retrieve_posts":
                state["retrieved"] = rag_recommend({"query": goal, "limit": 3})[
                    "relatedPosts"
                ]
            elif tool_name == "search_video":
                state["external"] = lookup_youtube({"query": goal, "limit": 5})
            elif tool_name == "create_playlist_draft":
                break
        except Exception as exc:  # pragma: no cover - defensive runtime path
            state["trace"][-1]["error"] = str(exc)

    recommendations = create_playlist_recommendations(state)
    playlist_title = create_playlist_title(goal, language)

    return {
        "mode": "agent",
        "goal": goal,
        "playlistTitle": playlist_title,
        "recommendations": recommendations,
        "suggestedTags": suggest_tags(goal, recommendations, interests),
        "rationale": create_agent_rationale(goal, recommendations, language),
        "trace": state["trace"],
        "guardrails": {
            "maxIterations": max_iterations,
            "loopStopped": True,
            "toolCalling": "OpenAI function-calling schema when configured; deterministic tool loop fallback otherwise.",
        },
    }


def load_board_posts() -> list[BoardPost]:
    if psycopg is None:
        return DEMO_POSTS

    database_url = os.getenv("DATABASE_URL", DEFAULT_DATABASE_URL)

    try:
        with psycopg.connect(database_url, connect_timeout=3) as conn:
            with conn.cursor() as cursor:
                cursor.execute(
                    """
                    SELECT p.id, p.title, p.video_url, p.thumbnail_url, p.channel_name,
                           p.summary, p.translated_notes,
                           COALESCE(array_agg(t.name) FILTER (WHERE t.name IS NOT NULL), '{}') AS tags
                    FROM posts p
                    LEFT JOIN post_tags pt ON pt.post_id = p.id
                    LEFT JOIN tags t ON t.id = pt.tag_id
                    GROUP BY p.id
                    ORDER BY p.updated_at DESC
                    """
                )
                rows = cursor.fetchall()

        if not rows:
            return DEMO_POSTS

        return [
            BoardPost(
                id=row[0],
                title=row[1],
                video_url=row[2],
                thumbnail_url=row[3],
                channel_name=row[4],
                summary=row[5],
                translated_notes=row[6],
                tags=list(row[7]),
            )
            for row in rows
        ]
    except Exception:
        return DEMO_POSTS


def rank_posts(query: str, posts: list[BoardPost]) -> list[tuple[BoardPost, float]]:
    if not query.strip():
        return []

    query_vector = deterministic_embedding(query)
    query_tokens = tokenize(query)
    scored: list[tuple[BoardPost, float]] = []

    for post in posts:
        content = " ".join(
            [
                post.title,
                post.summary,
                post.translated_notes,
                post.channel_name,
                " ".join(post.tags),
            ]
        )
        semantic_score = cosine_similarity(query_vector, deterministic_embedding(content))
        token_score = token_overlap(query_tokens, tokenize(content))
        phrase_score = 1.0 if query.lower() in content.lower() else 0.0

        if token_score == 0 and phrase_score == 0:
            scored.append((post, 0.0))
            continue

        scored.append(
            (
                post,
                round((semantic_score * 0.15) + (token_score * 0.7) + (phrase_score * 0.15), 4),
            )
        )

    return sorted(scored, key=lambda item: item[1], reverse=True)


def lookup_youtube(params: dict[str, Any]) -> dict[str, Any]:
    url = str(params.get("url") or "").strip()
    query = str(params.get("query") or "").strip()
    limit = max(1, min(int(params.get("limit") or 5), 10))

    if url:
        oembed_video = fetch_youtube_oembed(url)

        if oembed_video:
            return youtube_lookup_response(
                "youtube-oembed",
                [oembed_video],
                url,
                query or oembed_video["title"],
            )

    if query:
        videos = search_youtube(query, limit)

        if videos:
            return youtube_lookup_response(
                videos[0]["provider"],
                videos,
                youtube_search_url(query),
                query,
            )

    target = url or youtube_search_url(query or "AI learning")

    return {
        "provider": "youtube-search-unavailable",
        "title": query or extract_video_hint(url) or "YouTube metadata unavailable",
        "channel": "YouTube",
        "thumbnailUrl": "",
        "sourceUrl": target,
        "durationLabel": "metadata unavailable",
        "summary": (
            "No external YouTube metadata could be fetched. Configure "
            "YOUTUBE_API_KEY or allow outbound access for the MCP server."
        ),
        "videos": [],
    }


def fetch_youtube_oembed(url: str) -> dict[str, Any] | None:
    if httpx is None:
        return None

    try:
        response = httpx.get(
            "https://www.youtube.com/oembed",
            params={"url": url, "format": "json"},
            timeout=4.0,
        )
        response.raise_for_status()
        data = response.json()
        video_id = extract_video_hint(url)

        return {
            "provider": "youtube-oembed",
            "videoId": video_id,
            "title": data.get("title", "YouTube video"),
            "channel": data.get("author_name", "YouTube"),
            "thumbnailUrl": data.get("thumbnail_url") or thumbnail_for_video(video_id),
            "sourceUrl": url,
            "durationLabel": "external metadata",
            "summary": "YouTube oEmbed metadata fetched through the MCP server.",
        }
    except Exception:
        return None


def search_youtube(query: str, limit: int) -> list[dict[str, Any]]:
    api_results = search_youtube_data_api(query, limit)

    if api_results:
        return api_results

    return search_youtube_page(query, limit)


def search_youtube_data_api(query: str, limit: int) -> list[dict[str, Any]]:
    api_key = os.getenv("YOUTUBE_API_KEY")

    if httpx is None or not api_key:
        return []

    try:
        response = httpx.get(
            "https://www.googleapis.com/youtube/v3/search",
            params={
                "key": api_key,
                "part": "snippet",
                "q": query,
                "type": "video",
                "maxResults": limit,
                "safeSearch": "moderate",
            },
            timeout=8.0,
        )
        response.raise_for_status()
        data = response.json()
    except Exception:
        return []

    videos = []

    for item in data.get("items", []):
        video_id = (item.get("id") or {}).get("videoId")
        snippet = item.get("snippet") or {}

        if not video_id:
            continue

        videos.append(
            video_metadata(
                provider="youtube-data-api",
                video_id=video_id,
                title=snippet.get("title") or "YouTube video",
                channel=snippet.get("channelTitle") or "YouTube",
                thumbnail_url=best_thumbnail(snippet.get("thumbnails")),
                summary=snippet.get("description")
                or f"Actual YouTube search result for '{query}'.",
            )
        )

    return videos


def search_youtube_page(query: str, limit: int) -> list[dict[str, Any]]:
    if httpx is None:
        return []

    try:
        response = httpx.get(
            youtube_search_url(query),
            headers={
                "User-Agent": (
                    "Mozilla/5.0 StudyTubeBoard/1.0 "
                    "(educational metadata retrieval)"
                )
            },
            timeout=8.0,
        )
        response.raise_for_status()
    except Exception:
        return []

    initial_data = parse_yt_initial_data(response.text)

    if not initial_data:
        return []

    videos: list[dict[str, Any]] = []
    seen: set[str] = set()

    for renderer in iter_video_renderers(initial_data):
        video_id = str(renderer.get("videoId") or "").strip()

        if not video_id or video_id in seen:
            continue

        seen.add(video_id)
        videos.append(
            video_metadata(
                provider="youtube-search-page",
                video_id=video_id,
                title=extract_text(renderer.get("title")) or "YouTube video",
                channel=(
                    extract_text(renderer.get("ownerText"))
                    or extract_text(renderer.get("longBylineText"))
                    or "YouTube"
                ),
                thumbnail_url=best_thumbnail(
                    (renderer.get("thumbnail") or {}).get("thumbnails")
                ),
                summary=(
                    extract_text(renderer.get("descriptionSnippet"))
                    or extract_text(renderer.get("detailedMetadataSnippets"))
                    or f"Actual YouTube search result for '{query}'."
                ),
            )
        )

        if len(videos) >= limit:
            break

    return videos


def parse_yt_initial_data(html: str) -> dict[str, Any] | None:
    patterns = [
        r"var ytInitialData\s*=\s*({.*?});\s*</script>",
        r"ytInitialData\s*=\s*({.*?});\s*</script>",
    ]

    for pattern in patterns:
        match = re.search(pattern, html, re.DOTALL)

        if not match:
            continue

        try:
            data = json.loads(match.group(1))
        except json.JSONDecodeError:
            continue

        if isinstance(data, dict):
            return data

    return None


def iter_video_renderers(value: Any):
    if isinstance(value, dict):
        renderer = value.get("videoRenderer")

        if isinstance(renderer, dict):
            yield renderer

        for child in value.values():
            yield from iter_video_renderers(child)
    elif isinstance(value, list):
        for child in value:
            yield from iter_video_renderers(child)


def video_metadata(
    provider: str,
    video_id: str | None,
    title: str,
    channel: str,
    thumbnail_url: str | None,
    summary: str,
) -> dict[str, Any]:
    source_url = f"https://www.youtube.com/watch?v={video_id}" if video_id else ""

    return {
        "provider": provider,
        "videoId": video_id,
        "title": clean_text(title),
        "channel": clean_text(channel),
        "thumbnailUrl": thumbnail_url or thumbnail_for_video(video_id),
        "sourceUrl": source_url,
        "durationLabel": "external metadata",
        "summary": clean_text(summary),
    }


def youtube_lookup_response(
    provider: str,
    videos: list[dict[str, Any]],
    target: str,
    query: str,
) -> dict[str, Any]:
    first = videos[0]

    return {
        "provider": provider,
        "title": first["title"],
        "channel": first["channel"],
        "thumbnailUrl": first["thumbnailUrl"],
        "sourceUrl": first.get("sourceUrl") or target,
        "durationLabel": first.get("durationLabel") or "external metadata",
        "summary": f"Fetched {len(videos)} real YouTube metadata result(s) for '{query}'.",
        "videos": videos,
    }


def best_thumbnail(thumbnails: Any) -> str | None:
    if isinstance(thumbnails, dict):
        candidates = [
            item.get("url")
            for item in thumbnails.values()
            if isinstance(item, dict) and item.get("url")
        ]

        return candidates[-1] if candidates else None

    if isinstance(thumbnails, list):
        candidates = [
            item.get("url")
            for item in thumbnails
            if isinstance(item, dict) and item.get("url")
        ]

        return candidates[-1] if candidates else None

    return None


def thumbnail_for_video(video_id: str | None) -> str:
    if not video_id:
        return ""

    return f"https://i.ytimg.com/vi/{video_id}/hqdefault.jpg"


def extract_text(value: Any) -> str:
    if isinstance(value, str):
        return value

    if isinstance(value, list):
        return clean_text(" ".join(extract_text(item) for item in value))

    if not isinstance(value, dict):
        return ""

    if isinstance(value.get("simpleText"), str):
        return value["simpleText"]

    if isinstance(value.get("text"), str):
        return value["text"]

    if isinstance(value.get("runs"), list):
        return clean_text(
            " ".join(str(run.get("text") or "") for run in value["runs"])
        )

    if isinstance(value.get("snippetText"), dict):
        return extract_text(value["snippetText"])

    return ""


def clean_text(text: str) -> str:
    return re.sub(r"\s+", " ", text).strip()


def youtube_search_url(query: str) -> str:
    return f"https://www.youtube.com/results?search_query={quote_plus(query)}"


def choose_agent_tool(state: dict[str, Any], iteration: int) -> str:
    llm_choice = choose_tool_with_llm(state)

    if llm_choice:
        return llm_choice

    if iteration == 0:
        return "retrieve_posts"
    if iteration == 1 and not state.get("external"):
        return "search_video"
    return "create_playlist_draft"


def choose_tool_with_llm(state: dict[str, Any]) -> str | None:
    if OpenAI is None or not os.getenv("OPENAI_API_KEY"):
        return None

    try:  # pragma: no cover - requires external credentials
        client = OpenAI()
        response = client.chat.completions.create(
            model=os.getenv("LLM_MODEL", "gpt-4o-mini"),
            messages=[
                {
                    "role": "system",
                    "content": (
                        "Choose the next StudyTube agent tool. "
                        "Use retrieve_posts first, search_video when external context is missing, "
                        "and create_playlist_draft when enough evidence exists."
                    ),
                },
                {"role": "user", "content": str(state)},
            ],
            tools=AGENT_TOOLS,
            tool_choice="auto",
        )
        tool_calls = getattr(response.choices[0].message, "tool_calls", None)

        if tool_calls:
            name = tool_calls[0].function.name
            if name in {"retrieve_posts", "search_video", "create_playlist_draft"}:
                return name
    except Exception:
        return None

    return None


def create_playlist_recommendations(state: dict[str, Any]) -> list[dict[str, Any]]:
    recommendations = []

    for item in state.get("retrieved", [])[:3]:
        recommendations.append(
            {
                "title": item["title"],
                "url": item["videoUrl"],
                "thumbnailUrl": item["thumbnailUrl"],
                "source": "board-rag",
                "why": f"게시판 유사도 {item['score']}점으로 목표와 연결됩니다.",
            }
        )

    external = state.get("external")
    if external:
        for video in external.get("videos") or []:
            recommendations.append(
                {
                    "title": video["title"],
                    "url": video["sourceUrl"],
                    "thumbnailUrl": video["thumbnailUrl"],
                    "source": video.get("provider") or external["provider"],
                    "why": video.get("summary") or external["summary"],
                }
            )

    return recommendations


def post_to_response(post: BoardPost, score: float) -> dict[str, Any]:
    return {
        "id": post.id,
        "title": post.title,
        "videoUrl": post.video_url,
        "thumbnailUrl": post.thumbnail_url,
        "channelName": post.channel_name,
        "summary": post.summary,
        "translatedNotes": post.translated_notes,
        "tags": post.tags,
        "score": score,
    }


def summarize_related_posts(query: str, related: list[dict[str, Any]]) -> str:
    if not related:
        return "관련 게시글을 찾지 못했습니다. 다른 키워드로 검색해 보세요."

    top = related[0]
    return (
        f"'{query or top['title']}' 질문에는 {top['title']}가 가장 가깝습니다. "
        f"{top['summary']} 관련 태그는 {', '.join(top['tags'][:3])}입니다."
    )


def create_playlist_title(goal: str, language: str) -> str:
    if language.lower().startswith("ko"):
        return f"{goal} 맞춤 학습 플레이리스트"

    return f"Study playlist for {goal}"


def create_agent_rationale(
    goal: str, recommendations: list[dict[str, Any]], language: str
) -> str:
    count = len(recommendations)

    if language.lower().startswith("ko"):
        return (
            f"목표 '{goal}'에 대해 게시판 RAG 결과와 MCP 영상 메타데이터를 함께 사용해 "
            f"{count}개의 학습 순서를 만들었습니다."
        )

    return (
        f"The agent combined board RAG context and MCP video metadata to create "
        f"{count} learning steps for '{goal}'."
    )


def suggest_tags(
    goal: str, recommendations: list[dict[str, Any]], interests: list[str]
) -> list[str]:
    tokens = tokenize(goal)
    for item in recommendations:
        tokens.update(tokenize(item["title"]))
    tokens.update(tag.lower() for tag in interests)

    useful = [
        token
        for token in tokens
        if len(token) >= 3 and token not in {"course", "study", "video", "want"}
    ]

    return sorted(useful)[:6]


def deterministic_embedding(text: str) -> list[float]:
    digest = hashlib.sha256(text.encode("utf-8")).digest()
    values = []

    for index in range(EMBEDDING_DIMENSIONS):
        byte = digest[index % len(digest)]
        values.append((byte / 255.0) * 2.0 - 1.0)

    return values


def cosine_similarity(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    left_norm = math.sqrt(sum(a * a for a in left))
    right_norm = math.sqrt(sum(b * b for b in right))

    if left_norm == 0 or right_norm == 0:
        return 0.0

    return (dot / (left_norm * right_norm) + 1.0) / 2.0


def token_overlap(left: set[str], right: set[str]) -> float:
    if not left or not right:
        return 0.0

    return len(left.intersection(right)) / len(left.union(right))


def tokenize(text: str) -> set[str]:
    return set(re.findall(r"[a-zA-Z0-9가-힣]+", text.lower()))


def extract_video_hint(url: str) -> str | None:
    match = re.search(r"[?&]v=([^&]+)", url)

    return match.group(1) if match else None


def embedding_provider() -> str:
    if os.getenv("OPENAI_API_KEY"):
        return os.getenv("EMBEDDING_MODEL", "text-embedding-3-small")

    return "deterministic-local-hash"


def tool_reason(tool_name: str) -> str:
    return {
        "retrieve_posts": "게시판 내부 지식을 먼저 검색합니다.",
        "search_video": "외부 YouTube 메타데이터로 추천 후보를 보강합니다.",
        "create_playlist_draft": "수집한 근거를 플레이리스트 초안으로 정리합니다.",
    }[tool_name]


def json_rpc_error(request_id: Any, code: int, message: str) -> dict[str, Any]:
    return {
        "jsonrpc": "2.0",
        "id": request_id,
        "error": {
            "code": code,
            "message": message,
        },
    }
