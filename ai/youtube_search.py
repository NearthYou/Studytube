from __future__ import annotations

import json
import os
import re
from typing import Any
from urllib.parse import quote_plus

try:
    import httpx
except ModuleNotFoundError:  # pragma: no cover - local test fallback
    httpx = None


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


def extract_video_hint(url: str) -> str | None:
    match = re.search(r"[?&]v=([^&]+)", url)

    return match.group(1) if match else None
